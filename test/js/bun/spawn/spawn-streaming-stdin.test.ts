// @known-failing-on-windows: 1 failing
import { it, test, expect } from "bun:test";
import { spawn } from "bun";
import { bunExe, bunEnv, gcTick, dumpStats, expectMaxObjectTypeCount } from "harness";
import { closeSync, openSync } from "fs";
import { tmpdir, devNull } from "node:os";
import { join } from "path";
import { unlinkSync } from "node:fs";

const N = 100;
test("spawn can write to stdin multiple chunks", async () => {
  const interval = setInterval(dumpStats, 1000).unref();

  const maxFD = openSync(devNull, "w");
  for (let i = 0; i < N; i++) {
    var exited;
    await (async function () {
      const tmperr = join(tmpdir(), "stdin-repro-error.log." + i);

      const proc = spawn({
        cmd: [bunExe(), join(import.meta.dir, "stdin-repro.js")],
        stdout: "pipe",
        stdin: "pipe",
        stderr: "inherit",
        env: {
          ...bunEnv,
        },
      });
      exited = proc.exited;
      var counter = 0;
      var inCounter = 0;
      var chunks: any[] = [];
      const prom = (async function () {
        try {
          for await (var chunk of proc.stdout) {
            chunks.push(chunk);
          }
        } catch (e: any) {
          console.log(e.stack);
          throw e;
        }
        console.count("Finished stdout");
      })();

      const prom2 = (async function () {
        while (true) {
          proc.stdin!.write("Wrote to stdin!\n");
          await new Promise(resolve => setTimeout(resolve, 8));

          if (inCounter++ === 3) break;
        }
        await proc.stdin!.end();
        console.count("Finished stdin");
      })();

      await Promise.all([prom, prom2]);
      expect(Buffer.concat(chunks).toString().trim()).toBe("Wrote to stdin!\n".repeat(4).trim());
      await proc.exited;

      try {
        unlinkSync(tmperr);
      } catch (e) {}
    })();
  }

  closeSync(maxFD);
  const newMaxFD = openSync(devNull, "w");
  closeSync(newMaxFD);

  // assert we didn't leak any file descriptors
  expect(newMaxFD).toBe(maxFD);
  clearInterval(interval);
  await expectMaxObjectTypeCount(expect, "ReadableStream", 10);
  await expectMaxObjectTypeCount(expect, "ReadableStreamDefaultReader", 10);
  await expectMaxObjectTypeCount(expect, "ReadableByteStreamController", 10);
  await expectMaxObjectTypeCount(expect, "Subprocess", 5);
  dumpStats();
}, 60_000);
