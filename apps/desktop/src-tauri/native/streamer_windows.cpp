#define NOMINMAX
#include <windows.h>
#include <winternl.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <mmdeviceapi.h>
#include <functiondiscoverykeys_devpkey.h>
#include <wrl.h>
#include <propsys.h>
#include <propvarutil.h>
#include <atomic>
#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <set>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

using Microsoft::WRL::ComPtr;
using Microsoft::WRL::FtmBase;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;
using Microsoft::WRL::ClassicCom;

typedef void (*MLSMPcmCallback)(void *, const float *, size_t, float);
typedef void (*MLSMStatusCallback)(void *, int, const char *);

static std::string utf8(const std::wstring &value) {
    if (value.empty()) return {};
    int size = WideCharToMultiByte(CP_UTF8, 0, value.c_str(), (int)value.size(), nullptr, 0, nullptr, nullptr);
    std::string result((size_t)size, '\0');
    WideCharToMultiByte(CP_UTF8, 0, value.c_str(), (int)value.size(), result.data(), size, nullptr, nullptr);
    return result;
}

static std::wstring wide(const char *value) {
    if (!value || !*value) return {};
    int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value, -1, nullptr, 0);
    if (size <= 1) return {};
    std::wstring result((size_t)size, L'\0');
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value, -1, result.data(), size);
    result.pop_back();
    return result;
}

static std::string json_escape(const std::string &value) {
    std::ostringstream out;
    for (unsigned char character : value) {
        switch (character) {
            case '"': out << "\\\""; break; case '\\': out << "\\\\"; break;
            case '\b': out << "\\b"; break; case '\f': out << "\\f"; break;
            case '\n': out << "\\n"; break; case '\r': out << "\\r"; break; case '\t': out << "\\t"; break;
            default:
                if (character < 0x20) { char buffer[7]; snprintf(buffer, sizeof(buffer), "\\u%04x", character); out << buffer; }
                else out << character;
        }
    }
    return out.str();
}

static std::string hresult_message(HRESULT result) {
    char *message = nullptr;
    FormatMessageA(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
                   nullptr, (DWORD)result, MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT), (LPSTR)&message, 0, nullptr);
    std::string value = message ? message : "Windows audio error";
    if (message) LocalFree(message);
    while (!value.empty() && (value.back() == '\r' || value.back() == '\n')) value.pop_back();
    return value;
}

static bool process_loopback_supported() {
    typedef LONG(WINAPI *RtlGetVersionFn)(PRTL_OSVERSIONINFOW);
    HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
    auto getVersion = ntdll ? reinterpret_cast<RtlGetVersionFn>(GetProcAddress(ntdll, "RtlGetVersion")) : nullptr;
    RTL_OSVERSIONINFOW version{}; version.dwOSVersionInfoSize = sizeof(version);
    return getVersion && getVersion(&version) == 0 && version.dwMajorVersion >= 10 && version.dwBuildNumber >= 20348;
}

struct DeviceInfo { std::string id; std::string name; bool isDefault; };
struct ApplicationInfo { DWORD pid; std::string name; };

static std::string device_name(IMMDevice *device) {
    ComPtr<IPropertyStore> store;
    if (FAILED(device->OpenPropertyStore(STGM_READ, &store))) return "Audio device";
    PROPVARIANT value; PropVariantInit(&value);
    std::string result = "Audio device";
    if (SUCCEEDED(store->GetValue(PKEY_Device_FriendlyName, &value)) && value.vt == VT_LPWSTR && value.pwszVal)
        result = utf8(value.pwszVal);
    PropVariantClear(&value);
    return result;
}

static std::vector<DeviceInfo> enumerate_devices(EDataFlow flow) {
    std::vector<DeviceInfo> result;
    ComPtr<IMMDeviceEnumerator> enumerator;
    if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator)))) return result;
    LPWSTR defaultId = nullptr;
    ComPtr<IMMDevice> defaultDevice;
    if (SUCCEEDED(enumerator->GetDefaultAudioEndpoint(flow, eMultimedia, &defaultDevice))) defaultDevice->GetId(&defaultId);
    ComPtr<IMMDeviceCollection> devices;
    if (SUCCEEDED(enumerator->EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE, &devices))) {
        UINT count = 0; devices->GetCount(&count);
        for (UINT index = 0; index < count; ++index) {
            ComPtr<IMMDevice> device; LPWSTR id = nullptr;
            if (FAILED(devices->Item(index, &device)) || FAILED(device->GetId(&id))) continue;
            result.push_back({utf8(id), device_name(device), defaultId && wcscmp(defaultId, id) == 0});
            CoTaskMemFree(id);
        }
    }
    if (defaultId) CoTaskMemFree(defaultId);
    return result;
}

static std::string process_name(DWORD pid) {
    HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (!process) return "Process " + std::to_string(pid);
    wchar_t path[32768]; DWORD size = (DWORD)(sizeof(path) / sizeof(path[0]));
    std::string result = "Process " + std::to_string(pid);
    if (QueryFullProcessImageNameW(process, 0, path, &size)) {
        const wchar_t *basename = wcsrchr(path, L'\\');
        result = utf8(basename ? basename + 1 : path);
    }
    CloseHandle(process); return result;
}

static void append_audio_applications(IMMDevice *device, std::vector<ApplicationInfo> &result, std::set<DWORD> &seen) {
    ComPtr<IAudioSessionManager2> manager;
    if (FAILED(device->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr, &manager))) return;
    ComPtr<IAudioSessionEnumerator> sessions;
    if (FAILED(manager->GetSessionEnumerator(&sessions))) return;
    int count = 0; sessions->GetCount(&count);
    for (int index = 0; index < count; ++index) {
        ComPtr<IAudioSessionControl> control; ComPtr<IAudioSessionControl2> control2;
        DWORD pid = 0;
        if (FAILED(sessions->GetSession(index, &control)) || FAILED(control.As(&control2)) ||
            FAILED(control2->GetProcessId(&pid)) || pid == 0 || !seen.insert(pid).second) continue;
        LPWSTR display = nullptr; std::string name;
        if (SUCCEEDED(control->GetDisplayName(&display)) && display && *display) name = utf8(display);
        if (display) CoTaskMemFree(display);
        if (name.empty()) name = process_name(pid);
        result.push_back({pid, name});
    }
}

static std::vector<ApplicationInfo> enumerate_audio_applications() {
    std::vector<ApplicationInfo> result; std::set<DWORD> seen;
    ComPtr<IMMDeviceEnumerator> enumerator; ComPtr<IMMDeviceCollection> devices;
    if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator))) ||
        FAILED(enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &devices))) return result;
    UINT count = 0; devices->GetCount(&count);
    for (UINT index = 0; index < count; ++index) {
        ComPtr<IMMDevice> device;
        if (SUCCEEDED(devices->Item(index, &device))) append_audio_applications(device.Get(), result, seen);
    }
    return result;
}

extern "C" char *mlsm_streamer_capabilities_json(void) {
    HRESULT init = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    auto outputs = enumerate_devices(eRender); auto inputs = enumerate_devices(eCapture);
    bool processSupported = process_loopback_supported();
    auto applications = processSupported ? enumerate_audio_applications() : std::vector<ApplicationInfo>{};
    std::ostringstream json;
    json << "{\"platform\":\"windows\",\"backend\":\"WASAPI\",\"systemAudio\":true,\"applicationCapture\":" << (processSupported ? "true" : "false") << ",\"outputDevices\":[";
    for (size_t i = 0; i < outputs.size(); ++i) { if (i) json << ','; json << "{\"id\":\"" << json_escape(outputs[i].id) << "\",\"name\":\"" << json_escape(outputs[i].name) << "\",\"isDefault\":" << (outputs[i].isDefault ? "true" : "false") << '}'; }
    json << "],\"applications\":[";
    for (size_t i = 0; i < applications.size(); ++i) { if (i) json << ','; json << "{\"id\":\"" << applications[i].pid << "\",\"name\":\"" << json_escape(applications[i].name) << "\",\"processId\":" << applications[i].pid << '}'; }
    json << "],\"inputDevices\":[";
    for (size_t i = 0; i < inputs.size(); ++i) { if (i) json << ','; json << "{\"id\":\"" << json_escape(inputs[i].id) << "\",\"name\":\"" << json_escape(inputs[i].name) << "\",\"isDefault\":" << (inputs[i].isDefault ? "true" : "false") << '}'; }
    json << "],\"permission\":\"granted\"";
    if (!processSupported) json << ",\"reason\":\"Per-application capture requires Windows 10 build 20348 or newer\"";
    json << '}';
    if (SUCCEEDED(init)) CoUninitialize();
    std::string value = json.str(); char *copy = (char *)malloc(value.size() + 1);
    if (copy) memcpy(copy, value.c_str(), value.size() + 1); return copy;
}

extern "C" void mlsm_streamer_free_string(char *value) { free(value); }

class ActivationHandler final : public RuntimeClass<RuntimeClassFlags<ClassicCom>, FtmBase, IActivateAudioInterfaceCompletionHandler> {
public:
    HANDLE completed = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    HRESULT result = E_PENDING; ComPtr<IAudioClient> client;
    ~ActivationHandler() { if (completed) CloseHandle(completed); }
    STDMETHOD(ActivateCompleted)(IActivateAudioInterfaceAsyncOperation *operation) override {
        HRESULT activationResult = E_UNEXPECTED; ComPtr<IUnknown> unknown;
        result = operation->GetActivateResult(&activationResult, &unknown);
        if (SUCCEEDED(result)) result = activationResult;
        if (SUCCEEDED(result)) result = unknown.As(&client);
        SetEvent(completed); return S_OK;
    }
};

struct StreamerHandle {
    int kind = 0; std::wstring identifier; MLSMPcmCallback pcm = nullptr; MLSMStatusCallback status = nullptr; void *context = nullptr;
    std::thread worker; std::atomic<bool> stopping{false};
    std::mutex mutex; std::condition_variable ready; bool initialized = false; bool succeeded = false; std::string error;
};

static float sample_at(const BYTE *data, const WAVEFORMATEX *format, UINT32 frame, UINT32 channel) {
    UINT32 channels = std::max<UINT32>(1, format->nChannels), selected = std::min(channel, channels - 1);
    const BYTE *value = data + (size_t)frame * format->nBlockAlign + (size_t)selected * (format->wBitsPerSample / 8);
    WORD tag = format->wFormatTag;
    if (tag == WAVE_FORMAT_EXTENSIBLE && format->cbSize >= 22) {
        auto extensible = reinterpret_cast<const WAVEFORMATEXTENSIBLE *>(format);
        if (extensible->SubFormat.Data1 == WAVE_FORMAT_IEEE_FLOAT) tag = WAVE_FORMAT_IEEE_FLOAT;
        else if (extensible->SubFormat.Data1 == WAVE_FORMAT_PCM) tag = WAVE_FORMAT_PCM;
    }
    if (tag == WAVE_FORMAT_IEEE_FLOAT && format->wBitsPerSample == 32) { float sample; memcpy(&sample, value, 4); return sample; }
    if (tag == WAVE_FORMAT_PCM) {
        if (format->wBitsPerSample == 16) { int16_t sample; memcpy(&sample, value, 2); return sample / 32768.0f; }
        if (format->wBitsPerSample == 24) { int32_t sample = value[0] | (value[1] << 8) | (value[2] << 16); if (sample & 0x800000) sample |= ~0xffffff; return sample / 8388608.0f; }
        if (format->wBitsPerSample == 32) { int32_t sample; memcpy(&sample, value, 4); return sample / 2147483648.0f; }
    }
    return 0.0f;
}

static HRESULT activate_process_client(DWORD pid, ComPtr<IAudioClient> &client) {
    auto handler = Microsoft::WRL::Make<ActivationHandler>(); if (!handler) return E_OUTOFMEMORY;
    AUDIOCLIENT_ACTIVATION_PARAMS parameters{};
    parameters.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
    parameters.ProcessLoopbackParams.TargetProcessId = pid;
    parameters.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;
    PROPVARIANT property; PropVariantInit(&property); property.vt = VT_BLOB;
    property.blob.cbSize = sizeof(parameters); property.blob.pBlobData = reinterpret_cast<BYTE *>(&parameters);
    ComPtr<IActivateAudioInterfaceAsyncOperation> operation;
    HRESULT result = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient), &property, handler.Get(), &operation);
    if (FAILED(result)) return result;
    if (WaitForSingleObject(handler->completed, 15000) != WAIT_OBJECT_0) return HRESULT_FROM_WIN32(ERROR_TIMEOUT);
    if (FAILED(handler->result)) return handler->result;
    client = handler->client; return client ? S_OK : E_NOINTERFACE;
}

static HRESULT activate_endpoint_client(int kind, const std::wstring &identifier, ComPtr<IAudioClient> &client) {
    ComPtr<IMMDeviceEnumerator> enumerator; ComPtr<IMMDevice> device;
    HRESULT result = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator));
    if (FAILED(result)) return result;
    if (!identifier.empty()) result = enumerator->GetDevice(identifier.c_str(), &device);
    else result = enumerator->GetDefaultAudioEndpoint(kind == 3 ? eCapture : eRender, eMultimedia, &device);
    if (FAILED(result)) return result;
    return device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, &client);
}

static void mark_ready(StreamerHandle *handle, bool success, const std::string &error = {}) {
    { std::lock_guard<std::mutex> lock(handle->mutex); handle->succeeded = success; handle->error = error; handle->initialized = true; }
    handle->ready.notify_one();
}

static void capture_worker(StreamerHandle *handle) {
    HRESULT result = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    bool uninitialize = SUCCEEDED(result); ComPtr<IAudioClient> client;
    if (handle->kind == 1) {
        wchar_t *end = nullptr; unsigned long pid = wcstoul(handle->identifier.c_str(), &end, 10);
        if (!process_loopback_supported() || pid == 0 || (end && *end)) result = E_INVALIDARG;
        else result = activate_process_client((DWORD)pid, client);
    } else result = activate_endpoint_client(handle->kind, handle->identifier, client);
    WAVEFORMATEX processFormat{}; WAVEFORMATEX *format = nullptr;
    if (SUCCEEDED(result) && handle->kind == 1) {
        processFormat.wFormatTag = WAVE_FORMAT_IEEE_FLOAT; processFormat.nChannels = 2; processFormat.nSamplesPerSec = 48000;
        processFormat.wBitsPerSample = 32; processFormat.nBlockAlign = 8; processFormat.nAvgBytesPerSec = 384000; format = &processFormat;
    } else if (SUCCEEDED(result)) result = client->GetMixFormat(&format);
    DWORD flags = AUDCLNT_STREAMFLAGS_EVENTCALLBACK;
    if (handle->kind != 3) flags |= AUDCLNT_STREAMFLAGS_LOOPBACK;
    if (handle->kind == 1) flags |= AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
    if (SUCCEEDED(result)) result = client->Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 0, 0, format, nullptr);
    ComPtr<IAudioCaptureClient> capture;
    if (SUCCEEDED(result)) result = client->GetService(IID_PPV_ARGS(&capture));
    HANDLE wake = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    if (SUCCEEDED(result) && !wake) result = HRESULT_FROM_WIN32(GetLastError());
    if (SUCCEEDED(result)) result = client->SetEventHandle(wake);
    if (SUCCEEDED(result)) result = client->Start();
    if (FAILED(result)) {
        if (format && format != &processFormat) CoTaskMemFree(format);
        mark_ready(handle, false, hresult_message(result)); if (wake) CloseHandle(wake);
        if (uninitialize) CoUninitialize(); return;
    }
    mark_ready(handle, true); if (handle->status) handle->status(handle->context, 0, nullptr);
    HRESULT captureResult = S_OK;
    HANDLE process = nullptr;
    if (handle->kind == 1) process = OpenProcess(SYNCHRONIZE, FALSE, wcstoul(handle->identifier.c_str(), nullptr, 10));
    while (!handle->stopping.load(std::memory_order_acquire)) {
        if (process && WaitForSingleObject(process, 0) == WAIT_OBJECT_0) { captureResult = HRESULT_FROM_WIN32(ERROR_PROCESS_ABORTED); break; }
        DWORD wait = WaitForSingleObject(wake, 500);
        if (wait != WAIT_OBJECT_0 && wait != WAIT_TIMEOUT) { captureResult = HRESULT_FROM_WIN32(GetLastError()); break; }
        UINT32 available = 0;
        while (!handle->stopping.load() && SUCCEEDED(captureResult = capture->GetNextPacketSize(&available)) && available > 0) {
            BYTE *data = nullptr; DWORD captureFlags = 0; UINT64 devicePosition = 0, qpcPosition = 0;
            captureResult = capture->GetBuffer(&data, &available, &captureFlags, &devicePosition, &qpcPosition);
            if (FAILED(captureResult)) break;
            std::vector<float> stereo((size_t)available * 2, 0.0f);
            if ((captureFlags & AUDCLNT_BUFFERFLAGS_SILENT) == 0 && data) {
                for (UINT32 frame = 0; frame < available; ++frame) {
                    stereo[(size_t)frame * 2] = sample_at(data, format, frame, 0);
                    stereo[(size_t)frame * 2 + 1] = sample_at(data, format, frame, format->nChannels > 1 ? 1 : 0);
                }
            }
            if (handle->pcm) handle->pcm(handle->context, stereo.data(), available, (float)format->nSamplesPerSec);
            captureResult = capture->ReleaseBuffer(available); if (FAILED(captureResult)) break;
        }
        if (FAILED(captureResult)) break;
    }
    client->Stop();
    if (FAILED(captureResult) && !handle->stopping.load() && handle->status) {
        std::string message = hresult_message(captureResult); handle->status(handle->context, 2, message.c_str());
    }
    if (process) CloseHandle(process);
    if (format && format != &processFormat) CoTaskMemFree(format);
    if (wake) CloseHandle(wake);
    if (uninitialize) CoUninitialize();
}

static void write_error(char *buffer, size_t capacity, const std::string &message) {
    if (buffer && capacity) snprintf(buffer, capacity, "%s", message.c_str());
}

extern "C" void *mlsm_streamer_start(int kind, const char *identifier, MLSMPcmCallback pcm, MLSMStatusCallback status,
                                      void *context, char *errorBuffer, size_t errorCapacity) {
    if (kind < 0 || kind > 3 || !pcm) { write_error(errorBuffer, errorCapacity, "Invalid capture source"); return nullptr; }
    if (kind != 0 && (!identifier || !*identifier)) { write_error(errorBuffer, errorCapacity, "The selected source has no identifier"); return nullptr; }
    auto handle = new StreamerHandle(); handle->kind = kind; handle->identifier = wide(identifier); handle->pcm = pcm; handle->status = status; handle->context = context;
    handle->worker = std::thread(capture_worker, handle);
    std::unique_lock<std::mutex> lock(handle->mutex);
    if (!handle->ready.wait_for(lock, std::chrono::seconds(20), [&] { return handle->initialized; })) {
        handle->stopping.store(true); lock.unlock(); handle->worker.join(); delete handle;
        write_error(errorBuffer, errorCapacity, "WASAPI initialization timed out"); return nullptr;
    }
    bool succeeded = handle->succeeded; std::string error = handle->error; lock.unlock();
    if (!succeeded) { handle->worker.join(); delete handle; write_error(errorBuffer, errorCapacity, error); return nullptr; }
    return handle;
}

extern "C" void mlsm_streamer_stop(void *opaque) {
    auto handle = static_cast<StreamerHandle *>(opaque); if (!handle) return;
    handle->stopping.store(true, std::memory_order_release);
    if (handle->worker.joinable()) handle->worker.join();
    if (handle->status) handle->status(handle->context, 1, nullptr);
    delete handle;
}
