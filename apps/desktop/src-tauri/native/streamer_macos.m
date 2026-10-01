#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <CoreMedia/CoreMedia.h>
#import <AudioToolbox/AudioToolbox.h>

typedef void (*MLSMPcmCallback)(void *, const float *, size_t, float);
typedef void (*MLSMStatusCallback)(void *, int, const char *);

@class MLSMStreamerHandle;

@interface MLSMStreamerSink : NSObject <SCStreamOutput, SCStreamDelegate>
@property(nonatomic, weak) MLSMStreamerHandle *owner;
@end

@interface MLSMStreamerHandle : NSObject
@property(nonatomic, strong) SCStream *stream;
@property(nonatomic, strong) MLSMStreamerSink *sink;
@property(nonatomic) dispatch_queue_t queue;
@property(nonatomic) void *context;
@property(nonatomic) MLSMPcmCallback pcm;
@property(nonatomic) MLSMStatusCallback status;
@property(nonatomic) BOOL stopping;
@end

@implementation MLSMStreamerHandle
@end

static float mlsm_read_sample(const AudioBufferList *list, const AudioStreamBasicDescription *asbd,
                              UInt32 frame, UInt32 channel) {
    // ScreenCaptureKit may describe non-interleaved PCM while returning either
    // one multi-channel AudioBuffer or one buffer per channel.  Looking only at
    // the ASBD flag therefore duplicates buffer 0 into L/R for the first case.
    // Resolve the physical buffer from AudioBuffer.mNumberChannels instead.
    UInt32 requested = MIN(channel, MAX((UInt32)1, asbd->mChannelsPerFrame) - 1);
    UInt32 bufferIndex = 0;
    UInt32 channelInBuffer = requested;
    UInt32 channelOffset = 0;
    for (UInt32 index = 0; index < list->mNumberBuffers; index++) {
        UInt32 bufferChannels = MAX((UInt32)1, list->mBuffers[index].mNumberChannels);
        if (requested < channelOffset + bufferChannels) {
            bufferIndex = index;
            channelInBuffer = requested - channelOffset;
            break;
        }
        channelOffset += bufferChannels;
        bufferIndex = index;
        channelInBuffer = MIN(requested, bufferChannels - 1);
    }
    const AudioBuffer *buffer = &list->mBuffers[bufferIndex];
    if (!buffer->mData) return 0.0f;
    UInt32 bufferChannels = MAX((UInt32)1, buffer->mNumberChannels);
    UInt32 bytes = asbd->mBitsPerChannel / 8;
    if (bytes == 0 && asbd->mBytesPerFrame) {
        BOOL physicallyPlanar = list->mNumberBuffers > 1 && bufferChannels == 1;
        bytes = physicallyPlanar ? asbd->mBytesPerFrame : asbd->mBytesPerFrame / bufferChannels;
    }
    UInt32 sampleIndex = frame * bufferChannels + MIN(channelInBuffer, bufferChannels - 1);
    if (bytes == 0 || ((uint64_t)sampleIndex + 1) * bytes > buffer->mDataByteSize) return 0.0f;
    const uint8_t *value = (const uint8_t *)buffer->mData + (uint64_t)sampleIndex * bytes;
    if ((asbd->mFormatFlags & kAudioFormatFlagIsFloat) != 0) {
        if (bytes == 4) { float sample; memcpy(&sample, value, 4); return sample; }
        if (bytes == 8) { double sample; memcpy(&sample, value, 8); return (float)sample; }
    }
    if ((asbd->mFormatFlags & kAudioFormatFlagIsSignedInteger) != 0) {
        if (bytes == 2) { int16_t sample; memcpy(&sample, value, 2); return sample / 32768.0f; }
        if (bytes == 4) { int32_t sample; memcpy(&sample, value, 4); return sample / 2147483648.0f; }
    }
    return 0.0f;
}

@implementation MLSMStreamerSink
- (void)stream:(SCStream *)stream didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer ofType:(SCStreamOutputType)type {
    (void)stream;
    MLSMStreamerHandle *owner = self.owner;
    if (!owner || owner.stopping || type != SCStreamOutputTypeAudio || !CMSampleBufferDataIsReady(sampleBuffer)) return;
    CMAudioFormatDescriptionRef format = CMSampleBufferGetFormatDescription(sampleBuffer);
    const AudioStreamBasicDescription *asbd = format ? CMAudioFormatDescriptionGetStreamBasicDescription(format) : NULL;
    if (!asbd || asbd->mFormatID != kAudioFormatLinearPCM || asbd->mSampleRate <= 0) return;
    CMItemCount frameCount = CMSampleBufferGetNumSamples(sampleBuffer);
    if (frameCount <= 0 || frameCount > UINT32_MAX) return;
    size_t listSize = offsetof(AudioBufferList, mBuffers) + sizeof(AudioBuffer) * MAX((UInt32)1, asbd->mChannelsPerFrame);
    AudioBufferList *list = calloc(1, listSize);
    CMBlockBufferRef block = NULL;
    OSStatus result = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
        sampleBuffer, NULL, list, listSize, NULL, NULL,
        kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment, &block);
    if (result != noErr || list->mNumberBuffers == 0) {
        if (block) CFRelease(block);
        free(list); return;
    }
    float *stereo = malloc((size_t)frameCount * 2 * sizeof(float));
    if (stereo) {
        for (UInt32 frame = 0; frame < (UInt32)frameCount; frame++) {
            stereo[frame * 2] = mlsm_read_sample(list, asbd, frame, 0);
            stereo[frame * 2 + 1] = mlsm_read_sample(list, asbd, frame, asbd->mChannelsPerFrame > 1 ? 1 : 0);
        }
        if (owner.pcm) owner.pcm(owner.context, stereo, (size_t)frameCount, (float)asbd->mSampleRate);
        free(stereo);
    }
    if (block) CFRelease(block);
    free(list);
}

- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error {
    (void)stream;
    MLSMStreamerHandle *owner = self.owner;
    if (!owner || owner.stopping || !owner.status) return;
    owner.status(owner.context, 2, error.localizedDescription.UTF8String ?: "ScreenCaptureKit capture interrupted");
}
@end

static SCShareableContent *mlsm_shareable_content(NSError **outError) {
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    __block SCShareableContent *content = nil;
    __block NSError *error = nil;
    [SCShareableContent getShareableContentExcludingDesktopWindows:YES onScreenWindowsOnly:NO
        completionHandler:^(SCShareableContent *value, NSError *valueError) {
            content = value; error = valueError; dispatch_semaphore_signal(semaphore);
        }];
    if (dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC)) != 0) {
        if (outError) *outError = [NSError errorWithDomain:@"MLSMStreamer" code:1 userInfo:@{NSLocalizedDescriptionKey: @"Timed out while reading ScreenCaptureKit content"}];
        return nil;
    }
    if (outError) *outError = error;
    return content;
}

static NSString *mlsm_json_string(NSDictionary *value) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
    return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"{}";
}

char *mlsm_streamer_capabilities_json(void) {
    @autoreleasepool {
        BOOL supported = NO;
        if (@available(macOS 13.0, *)) supported = YES;
        BOOL granted = supported && CGPreflightScreenCaptureAccess();
        NSMutableArray *applications = [NSMutableArray array];
        if (supported) {
            for (NSRunningApplication *application in NSWorkspace.sharedWorkspace.runningApplications) {
                if (application.activationPolicy != NSApplicationActivationPolicyRegular || application.bundleIdentifier.length == 0) continue;
                [applications addObject:@{
                    @"id": application.bundleIdentifier,
                    @"name": application.localizedName ?: application.bundleIdentifier,
                    @"processId": @(application.processIdentifier)
                }];
            }
        }
        NSDictionary *result = @{
            @"platform": @"macos", @"backend": supported ? @"ScreenCaptureKit" : @"unavailable",
            @"systemAudio": @(supported), @"applicationCapture": @(supported),
            @"outputDevices": @[], @"applications": applications, @"inputDevices": @[],
            @"permission": !supported ? @"unavailable" : (granted ? @"granted" : @"notDetermined"),
            @"reason": supported ? [NSNull null] : @"ScreenCaptureKit audio capture requires macOS 13 or newer"
        };
        return strdup(mlsm_json_string(result).UTF8String);
    }
}

void mlsm_streamer_free_string(char *value) { free(value); }

static void mlsm_set_error(char *buffer, size_t capacity, NSString *message) {
    if (!buffer || capacity == 0) return;
    snprintf(buffer, capacity, "%s", message.UTF8String ?: "Native capture error");
}

void *mlsm_streamer_start(int kind, const char *identifier, MLSMPcmCallback pcm, MLSMStatusCallback status,
                          void *context, char *errorBuffer, size_t errorCapacity) {
    @autoreleasepool {
        if (@available(macOS 13.0, *)) {
            if (!CGPreflightScreenCaptureAccess() && !CGRequestScreenCaptureAccess()) {
                mlsm_set_error(errorBuffer, errorCapacity, @"Screen Recording/System Audio permission was denied"); return NULL;
            }
            if (kind == 2 || kind == 3) {
                mlsm_set_error(errorBuffer, errorCapacity, @"ScreenCaptureKit cannot capture a selected CoreAudio device"); return NULL;
            }
            NSError *contentError = nil;
            SCShareableContent *content = mlsm_shareable_content(&contentError);
            SCDisplay *display = content.displays.firstObject;
            if (!content || !display) { mlsm_set_error(errorBuffer, errorCapacity, contentError.localizedDescription ?: @"No capturable display is available"); return NULL; }
            SCContentFilter *filter = nil;
            if (kind == 1) {
                NSString *requested = identifier ? [NSString stringWithUTF8String:identifier] : @"";
                SCRunningApplication *selected = nil;
                for (SCRunningApplication *application in content.applications) {
                    if ([application.bundleIdentifier isEqualToString:requested] ||
                        [[NSString stringWithFormat:@"%d", application.processID] isEqualToString:requested]) { selected = application; break; }
                }
                if (!selected) { mlsm_set_error(errorBuffer, errorCapacity, @"The selected application is no longer available"); return NULL; }
                filter = [[SCContentFilter alloc] initWithDisplay:display includingApplications:@[selected] exceptingWindows:@[]];
            } else {
                filter = [[SCContentFilter alloc] initWithDisplay:display excludingApplications:@[] exceptingWindows:@[]];
            }
            SCStreamConfiguration *configuration = [SCStreamConfiguration new];
            configuration.width = 2; configuration.height = 2; configuration.queueDepth = 3;
            configuration.showsCursor = NO; configuration.capturesAudio = YES;
            configuration.excludesCurrentProcessAudio = NO;
            configuration.sampleRate = 48000; configuration.channelCount = 2;
            MLSMStreamerHandle *handle = [MLSMStreamerHandle new];
            handle.context = context; handle.pcm = pcm; handle.status = status;
            handle.queue = dispatch_queue_create("studio.mlsm.streamer.screencapturekit", DISPATCH_QUEUE_SERIAL);
            handle.sink = [MLSMStreamerSink new]; handle.sink.owner = handle;
            handle.stream = [[SCStream alloc] initWithFilter:filter configuration:configuration delegate:handle.sink];
            NSError *outputError = nil;
            if (![handle.stream addStreamOutput:handle.sink type:SCStreamOutputTypeAudio sampleHandlerQueue:handle.queue error:&outputError]) {
                mlsm_set_error(errorBuffer, errorCapacity, outputError.localizedDescription); return NULL;
            }
            dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
            __block NSError *startError = nil;
            [handle.stream startCaptureWithCompletionHandler:^(NSError *value) { startError = value; dispatch_semaphore_signal(semaphore); }];
            long startWait = dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC));
            if (startWait != 0 || startError) {
                handle.stopping = YES;
                handle.context = NULL; handle.pcm = NULL; handle.status = NULL;
                mlsm_set_error(errorBuffer, errorCapacity, startError.localizedDescription ?: @"ScreenCaptureKit start timed out");
                return NULL;
            }
            if (handle.status) handle.status(handle.context, 0, NULL);
            return (__bridge_retained void *)handle;
        }
        mlsm_set_error(errorBuffer, errorCapacity, @"ScreenCaptureKit audio capture requires macOS 13 or newer");
        return NULL;
    }
}

void mlsm_streamer_stop(void *opaque) {
    if (!opaque) return;
    MLSMStreamerHandle *handle = (__bridge_transfer MLSMStreamerHandle *)opaque;
    handle.stopping = YES;
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    [handle.stream stopCaptureWithCompletionHandler:^(__unused NSError *error) { dispatch_semaphore_signal(semaphore); }];
    dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC));
    if (handle.queue) dispatch_sync(handle.queue, ^{});
    if (handle.status) handle.status(handle.context, 1, NULL);
    handle.context = NULL; handle.pcm = NULL; handle.status = NULL;
}
