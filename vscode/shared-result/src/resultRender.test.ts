import test from 'node:test';
import assert from 'node:assert/strict';
import { renderResult, type LocationContext, type ResultPayload, type ResultItem } from './resultRender';

const relate = (uri: string): string => uri.replace('file:///root/', '');

function deps(ctx: (uri: string, line: number) => LocationContext | null): { relate: typeof relate; readContext: (uri: string, line: number) => Promise<LocationContext | null> } {
    return { relate, readContext: async (uri, line) => ctx(uri, line) };
}

const noContext = (): { relate: typeof relate; readContext: (uri: string, line: number) => Promise<LocationContext | null> } =>
    ({ relate, readContext: async () => null });

function payload(items: ResultItem[], p: Partial<ResultPayload> = {}): ResultPayload {
    return { title: 't', items, ...p };
}

test('label differs from source: `Symbol — path:` header, match shows real code', async () => {
    const text = await renderResult(payload(
        [{ label: '_TestTelemetryApp.init', uri: 'file:///root/tests/test_telemetry.py', line: 29 }],
    ), deps(() => ({
        match: '    async def init(self) -> None:',
        before: [{ lineno: 29, text: 'class _TestTelemetryApp(KMetaApplication):' }],
        after: [{ lineno: 31, text: '        await super().init()' }],
    })));
    assert.equal(text, [
        '_TestTelemetryApp.init — tests/test_telemetry.py:',
        '  29  class _TestTelemetryApp(KMetaApplication):',
        '  30:     async def init(self) -> None:',
        '  31          await super().init()',
    ].join('\n'));
});

test('⇅ fallback shape: bases section, anchor in the middle, subclasses section', async () => {
    const withMatch = deps(() => ({ match: 'class X', before: [], after: [] }));
    const text = await renderResult(payload([
        { label: '⇧ bases', contextValue: 'kindRoot', uri: '', line: 0, children: [
            { label: 'KMetaApplication', uri: 'file:///root/app.py', line: 20, children: [
                { label: 'FrontikApplication', uri: 'file:///root/frontik.py', line: 61 },
            ] },
        ] },
        { label: 'KMetaApplication', uri: 'file:///root/app.py', line: 20 },
        { label: '⇩ subclasses', contextValue: 'kindRoot', uri: '', line: 0, children: [
            { label: 'KMetaTestApplication', uri: 'file:///root/tests.py', line: 14 },
            { label: '_TestSentryApp', uri: 'file:///root/sentry.py', line: 51 },
        ] },
    ]), withMatch);
    assert.equal(text, [
        '⇧ bases',
        '  KMetaApplication — app.py:',
        '    21: class X',
        '',
        '    FrontikApplication — frontik.py:',
        '      62: class X',
        '',
        'KMetaApplication — app.py:',
        '  21: class X',
        '',
        '⇩ subclasses',
        '  KMetaTestApplication — tests.py:',
        '    15: class X',
        '',
        '  _TestSentryApp — sentry.py:',
        '    52: class X',
    ].join('\n'));
});

test('strict nesting: a linear chain indents one level per step; siblings blank-separated', async () => {
    const text = await renderResult(payload([
        { label: 'Frontik', uri: 'file:///root/f.py', line: 61, children: [
            { label: 'FastAPI', uri: 'file:///root/fa.py', line: 51, children: [
                { label: 'Starlette', uri: 'file:///root/st.py', line: 21 },
            ] },
            { label: 'HTTPServerConnectionDelegate', uri: 'file:///root/httputil.py', line: 658 },
        ] },
    ]), noContext());
    assert.equal(text, [
        'f.py:',
        '  62: Frontik',
        '',
        '  fa.py:',
        '    52: FastAPI',
        '',
        '    st.py:',
        '      22: Starlette',
        '',
        '  httputil.py:',
        '    659: HTTPServerConnectionDelegate',
    ].join('\n'));
});

test('usages shape: label equal to the trimmed source line collapses to a bare path header', async () => {
    const text = await renderResult(payload([
        { label: 'app: KMetaApplication,', uri: 'file:///root/tests/test_x.py', line: 32 },
    ]), deps(() => ({
        match: '    app: KMetaApplication,',
        before: [{ lineno: 32, text: 'def _setup_feature_graph(' }],
        after: [{ lineno: 34, text: '    model_features: ModelTypeFeatures,' }],
    })));
    assert.equal(text, [
        'tests/test_x.py:',
        '  32  def _setup_feature_graph(',
        '  33:     app: KMetaApplication,',
        '  34      model_features: ModelTypeFeatures,',
    ].join('\n'));
});

test('unreadable file: label stays, match falls back to label', async () => {
    const text = await renderResult(payload(
        [{ label: 'Gone', uri: 'file:///root/gone.py', line: 5 }],
    ), noContext());
    assert.equal(text, [
        'gone.py:',
        '  6: Gone',
    ].join('\n'));
});

test('truncation footer', async () => {
    const text = await renderResult(payload([], { truncatedUnknown: true }), noContext());
    assert.equal(text, '⋯ обрезано');
});
