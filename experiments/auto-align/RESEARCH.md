# Alignment quality review — 2026-11-12

## Confirmed local defects, not model claims

- `untangle` flattened all phrases in one layer into one sequence. Legitimate simultaneous phrases/backings were truncated or pushed forward. Postprocessing is now isolated per phrase/layer; approved/manual timings stay untouched. Changed timing loses its old high confidence.
- `to_units` enforced a 50 ms minimum after clipping to the audio window. Dense syllables could therefore run beyond the window. It now reserves feasible positive intervals inside the window; impossible millisecond-scale intervals are rejected.
- ASR hyphen joining could connect fragments from different inference chunks or across a long gap. It now requires the same chunk and nearby timestamps.

These are deterministic correctness fixes. They do not establish acoustic accuracy on the user's song.

## Incorrect initial line times

The existing fine aligner searches only around each input line's `t/end` (default padding 1.5 seconds). Model replacement alone cannot find a chorus tens of seconds away from that window.

The optional **Сначала найти строки по аудио** / `--locate-lines` mode adds a coarse stage:

1. Transcribe the vocal stem using the selected existing Whisper model.
2. Match normalized known lyrics to recognized words in monotonic song order. Keep the user's text, punctuation and syllable boundaries unchanged.
3. Accept a line window only with both edge tokens matched and >=80% token coverage. Repeated one-word lines cannot locate themselves. Reject invalid, reversed and implausibly long spans.
4. Fine-align supported phrases with the existing aligner. Skip unsupported phrases and return a warning instead of aligning in a guessed window.

This is opt-in, not a measured new default. It needs the full song context; selected subsets are refused in the UI. Repeated choruses, ASR omissions, stretched vowels and overlapping singers can still produce wrong anchors. Manual and approved words remain protected. Standalone backing-only lines have no lead-text anchor and are skipped in this mode; process them separately using their known windows. Existing automatic values on skipped lines are preserved, not erased.

## External candidates checked

- [WhisperX](https://github.com/m-bain/whisperX): ASR followed by language-specific wav2vec2 alignment. Its documentation explicitly lists overlapping speech and out-of-vocabulary text as limitations. Merely replacing our wrapper with WhisperX is not demonstrated to improve songs.
- [Qwen3-ASR and Qwen3-ForcedAligner](https://github.com/QwenLM/Qwen3-ASR): the official model table lists singing/background-music recognition for ASR and Russian support for both ASR and the 0.6B forced aligner. The forced aligner's documented domain is **speech**; singing timestamp accuracy is not established by that table. Good next A/B candidate, not a promised fix or silently installed dependency.
- [SOFA](https://github.com/qiuqiao/SOFA): explicitly singing-oriented, with phoneme alignment and confidence output. It needs a compatible checkpoint and pronunciation dictionary/G2P; the documented default is an opencpop/pinyin dictionary, not turnkey Russian song alignment. Russian suitability needs a specific model/dictionary evaluation.

No new model packages, weights or user audio were uploaded/downloaded for this review. No cloud transcription service is enabled.

## Verification and next measurement

Synthetic Python regressions exercise bounds, independent overlaps, manual protection, confidence invalidation, chunk-safe joining and coarse lyric matching. Browser scenarios mock inference; actual media source switching uses synthesized WAV data. These tests verify mechanics, **not** better singing accuracy.

The existing local benchmark contains four labeled examples and previously showed weak backing accuracy. A fair next model comparison must use the same original audio and hand timestamps, report median/p90 onset error, <=100/200 ms coverage, skipped words/lines, runtime and peak memory. Preserve skipped units in the denominator; do not report only successful matches. Also test a complete track imported with deliberately shifted/untimed lines and one with repeated choruses. The user's current failing MP3/project has been requested and has not yet been supplied.
