import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

export function loadTransactionModule(
  name,
  game,
  overrides = {},
  globals = {},
) {
  const cache = {};
  function load(name) {
    if (cache[name]) return cache[name];
    const exports = (cache[name] = {});
    const code = ts.transpileModule(
      fs.readFileSync(new URL(`../src/${name}.ts`, import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText;
    vm.runInNewContext(code, {
      exports,
      require: (key) => overrides[key] ?? load(key.slice(2)),
      game,
      Hooks: { on() {} },
      structuredClone,
      console,
      setTimeout,
      clearTimeout,
      ...globals,
    });
    return exports;
  }
  return load(name);
}
export function socketWorld(games) {
  const listeners = [];
  function connect(game) {
    game.socket = {
      on(channel, callback) {
        listeners.push({ game, channel, callback });
      },
      emit(channel, message) {
        for (const listener of listeners) {
          if (listener.channel === channel && listener.game !== game)
            queueMicrotask(() => listener.callback(structuredClone(message)));
        }
      },
    };
  }
  games.forEach(connect);
  return {
    connect,
    disconnect(game) {
      for (let i = listeners.length - 1; i >= 0; i--)
        if (listeners[i].game === game) listeners.splice(i, 1);
    },
  };
}
export const tick = () => new Promise((resolve) => setImmediate(resolve));
