/**
 * Smoke test for TTS cost metering — pure logic, no provider calls, no cost.
 *
 * The reader must show what a full-book job will consume before it runs, so the
 * numbers here matter: characters are exact, audio minutes are derived from the
 * measured narration speed of the same voice when available, and a dollar figure
 * only appears when the provider's rate is actually known.
 *
 * Run: npm run smoke:tts-cost
 */
import {
    DEFAULT_CHARS_PER_SECOND,
    buildTtsCostEstimate,
    countSpeakableCharacters,
    getTtsRate,
    resolveProviderFromVoice,
} from '../services/ttsCost.js';

let failures = 0;
function check(name: string, condition: boolean, detail = '') {
    if (condition) {
        console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
    } else {
        failures += 1;
        console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
    }
}

console.log('TTS cost metering smoke test\n');

console.log('1) provider detection + rates');
check('unprefixed voice is a google voice (matches resolveTtsVoice)', resolveProviderFromVoice('vi-VN-Wavenet-B') === 'google');
check('vbee provider detected from voice id', resolveProviderFromVoice('vbee-n_hn_male_ngankechuyen_ytstable_vc') === 'vbee');
check('azure provider detected', resolveProviderFromVoice('azure-vi-VN-HoaiMyNeural') === 'azure');
check('minimax provider detected', resolveProviderFromVoice('minimax-male-qn-qingse') === 'minimax');
check('google has a known rate', getTtsRate('vi-VN-Wavenet-B')?.usdPerMillionChars === 16);
check('unknown provider has no rate (no invented price)', getTtsRate('vbee-n_hn_male_ngankechuyen_ytstable_vc') === null);
check('azure has a known rate', getTtsRate('azure-vi-VN-HoaiMyNeural')?.usdPerMillionChars === 15);

console.log('\n2) character counting');
const chars = countSpeakableCharacters(['Trời hôm nay đẹp lạ thường.', '   ', '', 'Gió thổi nhẹ.']);
check('whitespace-only segments count as 0', chars === 'Trờihômnayđẹplạthường.'.length + 'Gióthổinhẹ.'.length, `${chars} chars`);
check('empty input is 0', countSpeakableCharacters([]) === 0);

console.log('\n3) estimate with a known rate');
const known = buildTtsCostEstimate({ voice: 'vi-VN-Wavenet-B', characters: 100_000 });
check('cost = chars / 1M × rate', known.estimatedCostUsd === 1.6, `$${known.estimatedCostUsd}`);
check('seconds fall back to the default narration speed', known.estimatedSeconds === Math.round(100_000 / DEFAULT_CHARS_PER_SECOND), `${known.estimatedSeconds}s`);
check('fallback marks the seconds as not measured', known.secondsFromMeasuredAudio === false);
check('rate source is reported for the UI label', Boolean(known.rateSource));

console.log('\n4) estimate for a provider without a published rate');
const unknownRate = buildTtsCostEstimate({ voice: 'vbee-n_hn_male_ngankechuyen_ytstable_vc', characters: 50_000 });
check('no dollar figure when the rate is unknown', unknownRate.estimatedCostUsd === null && unknownRate.ratePerMillionChars === null);
check('characters are still exact', unknownRate.characters === 50_000);
check('audio length is still estimated', unknownRate.estimatedSeconds === Math.round(50_000 / DEFAULT_CHARS_PER_SECOND), `${unknownRate.estimatedSeconds}s`);

console.log('\n5) measured narration speed of this book is preferred');
// 1,500 characters that took 100s of audio → 15 chars/sec observed.
const measured = buildTtsCostEstimate({
    voice: 'vbee-n_hn_male_ngankechuyen_ytstable_vc',
    characters: 3_000,
    measuredCharacters: 1_500,
    measuredSeconds: 100,
});
check('uses the observed rate', measured.estimatedSeconds === 200, `${measured.estimatedSeconds}s`);
check('flags the seconds as measured', measured.secondsFromMeasuredAudio === true);
const absurd = buildTtsCostEstimate({
    voice: 'vbee-n_hn_male_ngankechuyen_ytstable_vc',
    characters: 3_000,
    measuredCharacters: 300,
    measuredSeconds: 3_000, // 0.1 chars/sec — a broken probe, not a real voice
});
check('absurd measured rate is rejected and falls back', absurd.secondsFromMeasuredAudio === false
    && absurd.estimatedSeconds === Math.round(3_000 / DEFAULT_CHARS_PER_SECOND), `${absurd.estimatedSeconds}s`);

console.log('\n6) operator override via TTS_COST_RATES_JSON');
process.env.TTS_COST_RATES_JSON = JSON.stringify({ vbee: { usdPerMillionChars: 12, source: 'hợp đồng riêng' } });
const overridden = buildTtsCostEstimate({ voice: 'vbee-n_hn_male_ngankechuyen_ytstable_vc', characters: 1_000_000 });
check('override rate is applied', overridden.estimatedCostUsd === 12, `$${overridden.estimatedCostUsd}`);
check('override source is surfaced', overridden.rateSource === 'hợp đồng riêng');
process.env.TTS_COST_RATES_JSON = '{ not json';
const malformed = buildTtsCostEstimate({ voice: 'vi-VN-Wavenet-B', characters: 1_000_000 });
check('malformed override falls back to defaults', malformed.estimatedCostUsd === 16, `$${malformed.estimatedCostUsd}`);
delete process.env.TTS_COST_RATES_JSON;

console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);