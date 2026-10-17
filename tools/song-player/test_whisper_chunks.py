from __future__ import annotations
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import audio_analysis
import worker


def segment(start, end, text='hello'):
    return NS(text=text, start=start, end=end, avg_logprob=-.1,
              words=[NS(word=text, start=start, end=end, probability=.9)])


class WhisperChunkTests(unittest.TestCase):
    def run_transcription(self, duration, outputs, start=None, end=None, cancel=None):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / 'input.mp3'; source.write_bytes(b'audio')
            request = {'inputPath': str(source), 'jobRoot': root, 'model': 'whisper-base_timestamped', 'language': 'auto'}
            if start is not None:
                request.update(startSeconds=start, endSeconds=end)
            model = mock.Mock()
            model.transcribe.side_effect = [(iter(items), NS(language='it')) for items in outputs]
            factory = mock.Mock(return_value=model)
            def decode(_source, destination, *_args, **_kwargs): destination.write_bytes(b'chunk')
            with mock.patch.dict(sys.modules, {'ctranslate2': NS(), 'faster_whisper': NS(WhisperModel=factory)}), \
                 mock.patch.dict('os.environ', {'MLSM_WHISPER_CACHE': root}), \
                 mock.patch.object(worker, 'probe_media', return_value={'durationSeconds': duration}) as probe, \
                 mock.patch.object(worker, '_run_ffmpeg', side_effect=decode) as ffmpeg, \
                 mock.patch.object(worker, 'whisper_device_and_compute_type', return_value=('cpu', 'int8')), \
                 mock.patch.object(worker, 'progress'), \
                 mock.patch.object(worker, 'cancellation_requested', side_effect=cancel or (lambda: False)):
                try:
                    result = worker.transcribe_words(request)
                finally:
                    self.assertFalse((Path(root) / 'staging' / 'whisper-window.wav').exists())
                factory.assert_called_once()
                probe.assert_called_once_with(source.resolve(), max_duration_seconds=None)
                return result, ffmpeg.call_args_list, model.transcribe.call_args_list

    def test_long_audio_rebases_words_and_phrases_without_duplicate_overlap(self):
        # 2h + 1s = six full 20-minute chunks and a final short chunk.
        outputs = [[segment(1, 2, 'first'), segment(1200.2, 1200.8, 'next')],
                   [segment(.2, .8, 'previous'), segment(2.2, 2.8, 'next')]]
        outputs += [[segment(3, 4, str(i))] for i in range(2, 6)]
        outputs += [[segment(2.1, 2.8, 'last')]]
        result, calls, transcribes = self.run_transcription(7201, outputs)
        self.assertEqual(result['durationSeconds'], 7201)
        self.assertEqual([w['text'] for w in result['words']].count('next'), 1)
        self.assertNotIn('previous', result['transcript'])
        self.assertEqual(result['words'][1]['start'], 1200.2)
        self.assertEqual(result['words'][-1]['start'], 7200.1)
        self.assertEqual(result['phrases'][-1]['start'], 7200.1)
        self.assertEqual(len(calls), 7)
        self.assertEqual(calls[1].args[2:], (1198.0, 2402.0))
        self.assertEqual(calls[0].kwargs, {'sample_rate': 16000, 'channels': 1})
        self.assertEqual(transcribes[1].kwargs['language'], 'it')

    def test_long_selected_range_stays_relative_and_silence_is_allowed(self):
        outputs = [[], [segment(3, 4)]] + [[] for _ in range(5)]
        result, calls, _ = self.run_transcription(9000, outputs, 100, 7301)
        self.assertEqual(calls[0].args[2:], (100.0, 1302.0))
        self.assertEqual(result['words'][0]['start'], 1201)
        self.assertEqual(result['durationSeconds'], 7201)

    def test_short_audio_keeps_direct_path(self):
        result, calls, _ = self.run_transcription(90, [[segment(1, 2)]])
        self.assertEqual(calls, [])
        self.assertEqual(result['words'][0]['start'], 1)

    def test_cancel_removes_current_chunk(self):
        with self.assertRaisesRegex(worker.WorkerError, 'annullata'):
            self.run_transcription(7201, [[segment(1, 2)]], cancel=iter([False, True]).__next__)

    def test_probe_limit_is_disabled_only_when_explicitly_requested(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / 'input.mp3'; source.write_bytes(b'audio')
            output = {'streams': [{'sample_rate': '16000', 'channels': 1}], 'format': {'duration': '7201'}}
            with mock.patch.object(audio_analysis, 'resolve_tool', return_value='ffprobe'), mock.patch.object(audio_analysis, 'run_process', return_value=subprocess.CompletedProcess([], 0, json.dumps(output).encode(), b'')):
                with self.assertRaisesRegex(audio_analysis.AnalysisError, '2 ore'): audio_analysis.probe_media(source)
                self.assertEqual(audio_analysis.probe_media(source, max_duration_seconds=None)['durationSeconds'], 7201)

if __name__ == '__main__': unittest.main()
