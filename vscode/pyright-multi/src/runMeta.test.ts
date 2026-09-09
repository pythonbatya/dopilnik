import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDebugLaunch, buildPytestDebugLaunch, buildPytestSpec, buildRunSpec, findMainGuardLines, shellQuote } from './runMeta';

test('main guard with single quotes is found', () => {
    assert.deepEqual(findMainGuardLines("print('hi')\nif __name__ == '__main__':\n    main()\n"), [1]);
});

test('main guard with double quotes is found', () => {
    assert.deepEqual(findMainGuardLines('if __name__ == "__main__":\n    main()\n'), [0]);
});

test('main guard without spaces around == is found', () => {
    assert.deepEqual(findMainGuardLines("if __name__=='__main__':\n"), [0]);
});

test('indented main guard is found', () => {
    assert.deepEqual(findMainGuardLines("def main():\n    if __name__ == '__main__':\n        main()\n"), [1]);
});

test('main guard with trailing comment is found', () => {
    assert.deepEqual(findMainGuardLines("if __name__ == '__main__':  # entry point\n"), [0]);
});

test('multiple guards all found', () => {
    assert.deepEqual(findMainGuardLines("if __name__ == '__main__':\n    pass\nif __name__ == '__main__':\n    pass\n"), [0, 2]);
});

test('reversed comparison is not a guard', () => {
    assert.deepEqual(findMainGuardLines("'__main__' == __name__:\n"), []);
});

test('missing colon is not a guard', () => {
    assert.deepEqual(findMainGuardLines("if __name__ == '__main__'\n"), []);
});

test('prefixed name is not a guard', () => {
    assert.deepEqual(findMainGuardLines("if self.__name__ == '__main__':\n"), []);
});

test('mismatched quotes are not a guard', () => {
    assert.deepEqual(findMainGuardLines(`if __name__ == '__main__":\n`), []);
});

test('shellQuote plain string keeps single quotes', () => {
    assert.equal(shellQuote('src/app.py'), 'src/app.py');
});

test('shellQuote spaces are wrapped', () => {
    assert.equal(shellQuote('my file.py'), "'my file.py'");
});

test('shellQuote inner single quote is escaped', () => {
    assert.equal(shellQuote("it's.py"), "'it'\\''s.py'");
});

test('shellQuote empty string becomes empty quotes', () => {
    assert.equal(shellQuote(''), "''");
});

test('file under module runs with module venv python from module root', () => {
    const modules = [{ root: '/Users/x/projects/k-meta', venv: '/Users/x/projects/k-meta/.venv' }];
    const spec = buildRunSpec(modules, '/Users/x/projects/k-meta/.qqq/scratch_1.py');
    assert.equal(spec.cwd, '/Users/x/projects/k-meta');
    assert.equal(spec.python, '/Users/x/projects/k-meta/.venv/bin/python');
    assert.equal(spec.fileArg, '.qqq/scratch_1.py');
    assert.equal(spec.commandLine, 'cd /Users/x/projects/k-meta && /Users/x/projects/k-meta/.venv/bin/python .qqq/scratch_1.py');
    assert.equal(spec.terminalKey, '/Users/x/projects/k-meta:.qqq/scratch_1.py');
    assert.equal(spec.terminalName, 'pm: k-meta/.qqq/scratch_1.py');
    assert.equal(spec.venv, '/Users/x/projects/k-meta/.venv');
});

test('explicit module venv is respected, cwd stays module root', () => {
    const modules = [{ root: '/Users/x/projects/hh.kardinal', venv: '/Users/x/tmp/test_venv' }];
    const spec = buildRunSpec(modules, '/Users/x/projects/hh.kardinal/subproject/main.py');
    assert.equal(spec.cwd, '/Users/x/projects/hh.kardinal');
    assert.equal(spec.python, '/Users/x/tmp/test_venv/bin/python');
    assert.equal(spec.fileArg, 'subproject/main.py');
    assert.equal(spec.venv, '/Users/x/tmp/test_venv');
});

test('file directly in module root has bare filename', () => {
    const modules = [{ root: '/Users/x/projects/k-meta', venv: '/Users/x/projects/k-meta/.venv' }];
    const spec = buildRunSpec(modules, '/Users/x/projects/k-meta/scratch.py');
    assert.equal(spec.fileArg, 'scratch.py');
    assert.equal(spec.terminalName, 'pm: k-meta/scratch.py');
});

test('deepest module wins for run spec', () => {
    const modules = [
        { root: '/Users/x/projects', venv: '/Users/x/projects/.venv' },
        { root: '/Users/x/projects/hh.kardinal', venv: '/Users/x/projects/hh.kardinal/.venv' },
    ];
    const spec = buildRunSpec(modules, '/Users/x/projects/hh.kardinal/sub/main.py');
    assert.equal(spec.cwd, '/Users/x/projects/hh.kardinal');
});

test('file outside any module runs with system python from its directory', () => {
    const modules = [{ root: '/Users/x/projects/k-meta', venv: '/Users/x/projects/k-meta/.venv' }];
    const spec = buildRunSpec(modules, '/Users/x/other/tool.py');
    assert.equal(spec.cwd, '/Users/x/other');
    assert.equal(spec.python, 'python3');
    assert.equal(spec.fileArg, 'tool.py');
    assert.equal(spec.commandLine, 'cd /Users/x/other && python3 tool.py');
    assert.equal(spec.terminalKey, '/Users/x/other/tool.py');
    assert.equal(spec.terminalName, 'pm: tool.py');
    assert.equal(spec.venv, null);
});

test('same basename in two modules gets distinct terminal keys', () => {
    const modules = [
        { root: '/Users/x/projects/k-meta', venv: '/Users/x/projects/k-meta/.venv' },
        { root: '/Users/x/projects/vecsearch', venv: '/Users/x/projects/vecsearch/.venv' },
    ];
    const a = buildRunSpec(modules, '/Users/x/projects/k-meta/.qqq/scratch_1.py');
    const b = buildRunSpec(modules, '/Users/x/projects/vecsearch/.qqq/scratch_1.py');
    assert.notEqual(a.terminalKey, b.terminalKey);
    assert.notEqual(a.terminalName, b.terminalName);
});

test('debug launch under module uses venv python and module root', () => {
    const modules = [{ root: '/Users/x/projects/k-meta', venv: '/Users/x/projects/k-meta/.venv' }];
    const cfg = buildDebugLaunch(modules, '/Users/x/projects/k-meta/.qqq/scratch_1.py');
    assert.equal(cfg.type, 'debugpy');
    assert.equal(cfg.request, 'launch');
    assert.equal(cfg.name, 'pm debug: k-meta/.qqq/scratch_1.py');
    assert.equal(cfg.program, '/Users/x/projects/k-meta/.qqq/scratch_1.py');
    assert.equal(cfg.cwd, '/Users/x/projects/k-meta');
    assert.equal(cfg.python, '/Users/x/projects/k-meta/.venv/bin/python');
    assert.equal(cfg.console, 'integratedTerminal');
    assert.equal(cfg.env.VIRTUAL_ENV, '/Users/x/projects/k-meta/.venv');
    assert.equal(cfg.env.PATH, `/Users/x/projects/k-meta/.venv/bin:${process.env.PATH}`);
});

test('debug launch outside modules uses system python from file dir without env', () => {
    const modules = [{ root: '/Users/x/projects/k-meta', venv: '/Users/x/projects/k-meta/.venv' }];
    const cfg = buildDebugLaunch(modules, '/Users/x/other/tool.py');
    assert.equal(cfg.python, 'python3');
    assert.equal(cfg.cwd, '/Users/x/other');
    assert.equal(cfg.name, 'pm debug: tool.py');
    assert.deepEqual(cfg.env, {});
});

test('pytest spec uses one terminal per module', () => {
    const modules = [{ root: '/Users/x/projects/k-meta', venv: '/Users/x/projects/k-meta/.venv' }];
    const nodeId = 'tests/test_search.py::TestSearch::test_query';
    const spec = buildPytestSpec(modules, '/Users/x/projects/k-meta/tests/test_search.py', nodeId);
    assert.equal(spec.cwd, '/Users/x/projects/k-meta');
    assert.equal(spec.python, '/Users/x/projects/k-meta/.venv/bin/python');
    assert.equal(spec.commandLine, `cd /Users/x/projects/k-meta && /Users/x/projects/k-meta/.venv/bin/python -m pytest ${nodeId}`);
    assert.equal(spec.terminalKey, '/Users/x/projects/k-meta:pytest');
    assert.equal(spec.terminalName, 'pm: pytest k-meta');
    assert.equal(spec.venv, '/Users/x/projects/k-meta/.venv');
});

test('pytest specs for two targets of one module share the terminal', () => {
    const modules = [{ root: '/Users/x/projects/k-meta', venv: '/Users/x/projects/k-meta/.venv' }];
    const a = buildPytestSpec(modules, '/Users/x/projects/k-meta/tests/test_a.py', 'tests/test_a.py::test_one');
    const b = buildPytestSpec(modules, '/Users/x/projects/k-meta/tests/test_b.py', 'tests/test_b.py::TestTwo::test_x');
    assert.equal(a.terminalKey, b.terminalKey);
});

test('pytest spec outside modules uses python3 and a dir-scoped terminal', () => {
    const modules = [{ root: '/Users/x/projects/k-meta', venv: '/Users/x/projects/k-meta/.venv' }];
    const spec = buildPytestSpec(modules, '/Users/x/other/test_tool.py', 'test_tool.py::test_a');
    assert.equal(spec.cwd, '/Users/x/other');
    assert.equal(spec.python, 'python3');
    assert.equal(spec.commandLine, 'cd /Users/x/other && python3 -m pytest test_tool.py::test_a');
    assert.equal(spec.terminalKey, '/Users/x/other:pytest');
    assert.equal(spec.terminalName, 'pm: pytest other');
    assert.equal(spec.venv, null);
});

test('pytest debug launch runs pytest as module with node id', () => {
    const modules = [{ root: '/Users/x/projects/k-meta', venv: '/Users/x/projects/k-meta/.venv' }];
    const nodeId = 'tests/test_search.py::TestSearch::test_query';
    const cfg = buildPytestDebugLaunch(modules, '/Users/x/projects/k-meta/tests/test_search.py', nodeId);
    assert.equal(cfg.type, 'debugpy');
    assert.equal(cfg.request, 'launch');
    assert.equal(cfg.module, 'pytest');
    assert.deepEqual(cfg.args, [nodeId]);
    assert.equal(cfg.python, '/Users/x/projects/k-meta/.venv/bin/python');
    assert.equal(cfg.cwd, '/Users/x/projects/k-meta');
    assert.equal(cfg.name, `pm debug: pytest ${nodeId}`);
    assert.equal(cfg.env.VIRTUAL_ENV, '/Users/x/projects/k-meta/.venv');
});
