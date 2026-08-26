// 閿欒鐮佸洖褰掞紙鏂规 搂16.1锛歝ode 鏄ǔ瀹氭灇涓撅紝璋冪敤鏂规嵁姝ゅ仛鍙鏈?UI锛屼笉寰楅殢鏂囨婕傜Щ锛夈€?// 浜斾釜 code 鍏ㄨ矾寰勮鐩栵細
// - ERR_TOO_LARGE锛歮axBytes 鎶ゆ爮鍏堜簬浠讳綍鎻掍欢鐭矾
// - ERR_UNSUPPORTED锛氭棤鎻掍欢鍖归厤 鈫?binary 闄嶇骇鎼哄甫 code
// - ERR_PARSE锛歰ffice/pdf 鎻掍欢鍠傛崯鍧忔枃浠剁洿鎺ユ柇瑷€锛涜皟搴﹀櫒璺宠繃 error 缁撴灉灏濊瘯涓嬩竴鎻掍欢
// - ERR_ABORTED锛氬閮?AbortSignal 鎵ц涓彇娑?鈫?PreviewAbortError
// - ERR_TIMEOUT锛歰pts.timeout 鍒版湡 鈫?PreviewTimeoutError
import { describe, it, expect } from 'vitest';
import { PreviewErrorCode, PreviewAbortError, PreviewTimeoutError } from '../src/errors.ts';
import { combineSignal, createPreviewer, runPipeline } from '../src/previewer.ts';
import { nodeAdapter } from '../src/env.ts';
import { officePlugin } from '@file-preview/plugin-office';
import { pdfPlugin } from '@file-preview/plugin-pdf';
import type { PreviewResult } from '../src/types.ts';
import { memFile, staticPlugin, hangUntilAbortPlugin } from './helpers.ts';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('閿欒鐮佹灇涓剧ǔ瀹氭€?', () => {
  it('浜斾釜 code 涓庢柟妗?搂16 琛ㄦ牸閫牸閫愬瓧涓€鑷达紙闃叉剰澶栭噸鍛藉悕/澧炲垹锛?', () => {
    expect(Object.values(PreviewErrorCode)).toEqual([
      'ERR_UNSUPPORTED',
      'ERR_TOO_LARGE',
      'ERR_PARSE',
      'ERR_ABORTED',
      'ERR_TIMEOUT',
    ]);
  });

  it('Abort/Timeout 閿欒瀵硅薄鎼哄甫绋冲畾 code 涓庡彲璇嗗埆 name', () => {
    expect(new PreviewAbortError().code).toBe('ERR_ABORTED');
    expect(new PreviewTimeoutError().code).toBe('ERR_TIMEOUT');
    expect(new PreviewAbortError().name).toBe('PreviewAbortError');
    expect(new PreviewTimeoutError().name).toBe('PreviewTimeoutError');
  });
});

describe('ERR_TOO_LARGE锛歮axBytes 鎶ゆ爮', () => {
  it('瓒呴檺杩斿洖 binary 闄嶇骇 info.code=ERR_TOO_LARGE锛屼笖鎶ゆ爮鍏堜簬鎻掍欢锛堟彃浠堕浂璋冪敤锛?', async () => {
    const log: string[] = [];
    const boom = staticPlugin('boom', 100, () => ({ kind: 'text', text: 'should not happen' }), log);
    const pv = createPreviewer({ plugins: [boom] });

    const r = await pv.preview(memFile('big.bin', new Uint8Array(200)), nodeAdapter, { maxBytes: 100 });

    expect(r.kind).toBe('binary');
    if (r.kind !== 'binary') return;
    expect(r.info?.code).toBe(PreviewErrorCode.TOO_LARGE);
    expect(log).toEqual([]);
  });
});

describe('ERR_UNSUPPORTED锛氭棤鎻掍欢鍖归厤', () => {
  it('鍏ㄩ儴鎻掍欢 test=0 鈫?fallback binary info.code=ERR_UNSUPPORTED', async () => {
    const never = staticPlugin('never', 0, () => ({ kind: 'text', text: 'nope' }));
    const pv = createPreviewer({ plugins: [never] });

    const r = await pv.preview(memFile('mystery.bin', Uint8Array.from([0x00, 0xff])), nodeAdapter);

    expect(r.kind).toBe('binary');
    if (r.kind !== 'binary') return;
    expect(r.info?.code).toBe(PreviewErrorCode.UNSUPPORTED);
  });
});

describe('ERR_PARSE锛氭彃浠惰В鏋愬け璐?', () => {
  it('office 鎻掍欢鍠傛崯鍧?docx 鈫?{kind:error, code:ERR_PARSE}', async () => {
    // PK 澶磋 zipHint/鎵╁睍鍚嶅垽瀹氶€氳繃锛屽唴瀹瑰瀮鍦句娇 mammoth/exceljs 蹇呯劧鎶涢敊
    const garbage = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01, 0x02, 0x03, 0xde, 0xad]);
    const r = await officePlugin().preview(memFile('broken.docx', garbage), nodeAdapter, {});
    expect(r.kind).toBe('error');
    if (r.kind !== 'error') return;
    expect(r.code).toBe(PreviewErrorCode.PARSE);
  });

  it('pdf 鎻掍欢鍠傛崯鍧?PDF 鈫?{kind:error, code:ERR_PARSE}', async () => {
    const bad = utf8('%PDF-1.7\nthis is not a real pdf body\n%%EOF');
    const r = await pdfPlugin().preview(memFile('broken.pdf', bad), nodeAdapter, {});
    expect(r.kind).toBe('error');
    if (r.kind !== 'error') return;
    expect(r.code).toBe(PreviewErrorCode.PARSE);
  });
});

describe('璋冨害鍣ㄥ error 缁撴灉鐨勮矾鐢辫涔?', () => {
  it('楂樹紭鍏堟彃浠惰繑鍥?error 鈫?鎸変紭鍏堢骇灏濊瘯涓嬩竴涓彃浠跺苟閲囩撼鍏剁粨鏋?', async () => {
    const log: string[] = [];
    const bad = staticPlugin('bad-high', 200, (): PreviewResult => ({ kind: 'error', code: PreviewErrorCode.PARSE, message: 'x' }), log);
    const good = staticPlugin('good-low', 100, () => ({ kind: 'text', text: 'fallback-ok' }), log);

    const r = await runPipeline(memFile('any.txt', utf8('data')), nodeAdapter, {}, [good, bad]);

    expect(log).toEqual(['bad-high', 'good-low']);
    expect(r.kind).toBe('text');
    if (r.kind !== 'text') return;
    expect(r.text).toBe('fallback-ok');
  });

  it('鎵€鏈夋彃浠跺潎杩斿洖 error 鈫?鏈€缁?UNSUPPORTED 浜岃繘鍒堕檷绾?', async () => {
    const errResult = (): PreviewResult => ({ kind: 'error', code: PreviewErrorCode.PARSE, message: 'x' });
    const a = staticPlugin('a', 200, errResult);
    const b = staticPlugin('b', 100, errResult);

    const r = await runPipeline(memFile('any.txt', utf8('data')), nodeAdapter, {}, [a, b]);

    expect(r.kind).toBe('binary');
    if (r.kind !== 'binary') return;
    expect(r.info?.code).toBe(PreviewErrorCode.UNSUPPORTED);
  });
});

describe('ERR_ABORTED锛氬閮?AbortSignal 鍙栨秷', () => {
  it('鎵ц涓鍙栨秷 鈫?鎶?PreviewAbortError(code=ERR_ABORTED)', async () => {
    const ctrl = new AbortController();
    const p = runPipeline(memFile('slow.txt', utf8('slow')), nodeAdapter, { signal: ctrl.signal }, [
      hangUntilAbortPlugin(),
    ]);
    setTimeout(() => ctrl.abort(), 5);

    let err: unknown;
    try {
      await p;
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PreviewAbortError);
    expect((err as PreviewAbortError).code).toBe(PreviewErrorCode.ABORTED);
  });

  it('璋冪敤鍓?signal 宸蹭腑姝?鈫?绔嬪嵆鎶?PreviewAbortError锛堜笉鎸傝捣銆佷笉璇姤瓒呮椂锛?', async () => {
    const ctrl = new AbortController();
    ctrl.abort(); // 鍏堜腑姝㈠啀浼犲叆锛涗慨澶嶅墠鎰忓浘涓㈠け锛屾寕璧峰埌 timeout 鍚庤鎶?PreviewTimeoutError
    let err: unknown;
    try {
      await runPipeline(memFile('slow.txt', utf8('slow')), nodeAdapter, { signal: ctrl.signal, timeout: 200 }, [
        hangUntilAbortPlugin(),
      ]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PreviewAbortError);
    expect((err as PreviewAbortError).code).toBe(PreviewErrorCode.ABORTED);
  });
});

describe('combineSignal锛氶涓 signal 鍥炲綊', () => {
  it('宸蹭腑姝㈢殑 user signal 鈫?杩斿洖鐨?signal 绔嬪嵆 aborted锛宼imedOut=false', () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const { signal, timedOut } = combineSignal(ctrl.signal, 30_000);
    expect(signal.aborted).toBe(true);
    expect(timedOut()).toBe(false); // 鍙栨秷鏉ヨ嚜鐢ㄦ埛鑰岄潪瓒呮椂 鈫?runPipeline 鎶?ABORTED 鑰岄潪 TIMEOUT
  });

  it('鏈腑姝㈢殑 user signal 鈫?鍚堝苟淇″彿姝ｅ父閫忎紶鍙栨秷', () => {
    const ctrl = new AbortController();
    const { signal, timedOut } = combineSignal(ctrl.signal, 30_000);
    expect(signal.aborted).toBe(false);
    ctrl.abort();
    expect(signal.aborted).toBe(true);
    expect(timedOut()).toBe(false);
  });
});

describe('ERR_TIMEOUT锛氳秴鏃跺悎骞舵満鍒?', () => {
  it('瓒呰繃 opts.timeout 鈫?鎶?PreviewTimeoutError(code=ERR_TIMEOUT)', async () => {
    let err: unknown;
    try {
      await runPipeline(memFile('slow.txt', utf8('slow')), nodeAdapter, { timeout: 50 }, [
        hangUntilAbortPlugin(),
      ]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PreviewTimeoutError);
    expect((err as PreviewTimeoutError).code).toBe(PreviewErrorCode.TIMEOUT);
  });
});
