# pi-minimum-sufficient-output

Minimum sufficient output for pi, in two parts:

- **Transcript:** one line per tool call, full output on ctrl+o.
- **Responses:** a minimum-sufficient-output policy added to pi's system prompt, so the model
  answers first and leaves out what the reader does not need (see [Response policy](#response-policy)).

```
pi install npm:pi-minimum-sufficient-output
```

Or in `~/.pi/agent/settings.json`: `"packages": ["npm:pi-minimum-sufficient-output"]`.

```
  read   src/foo.sh:40–70                                    ✓
  read   lib/util.ts  (214 lines)                             ✓
  edit   bar.sh  +15 −20                                      ✓
  edit   3 files  +42 −8                                      ✓
  write  new.ts  (120 lines)                                  ✓
  run    pnpm typecheck  exit 2 · src/a.ts(3,1): error TS2304… ✗
  find   rg "x" src  12 hits                                  ✓
  web    search "q" ×4  24 results                       6.2s ✓
  spawn  backend · claude-opus·high  root.3                   ✓
  send   → parent                                             ✓

  1m 33s · model 1m 20s ×7 · tools 13.0s ×12
```

Rows are colored by role, not dimmed as a whole: verb muted, target in text color, result muted
(`+` green, `−` red, a failure's text red), duration muted. The status mark (`✓` green, `✗` red, `◌`
yellow while running) and the duration are right-aligned, at most 100 columns from the row start, and rows are
indented two columns so they read as steps under the model's text.
Press ctrl+o (or click a row) to expand: every row then shows the tool's own full view, exactly as
without this package.

## What it does

It is display only. It uses `pi.registerToolRenderer` to wrap the renderers of every tool — the
built-ins, [pi-multiedit](https://github.com/jkeskikangas/pi-multiedit)'s `edit`/`read`, MCP
tools, pi-actors' `spawn`/`send`/`stop`, pi-web-access tools, and tools it has never heard of. No
tool is registered or changed, so the model receives exactly what it did before.

| Tool | Line |
|---|---|
| `read` | path and the range actually read (`:40–70`, `(of 5000)` when truncated); whole file: `(214 lines)` |
| `edit` | path or `N files`, `+added −removed` from the diff (built-in `details.diff` and pi-multiedit `details.files`) |
| `write` | path and line count |
| `bash` | first line of the command (heredoc → `cmd <<…`), `✓ duration`; on failure `✗ exit N · <first error-looking line>` |
| `grep` / `find` / `ls` | `rg "pattern" path` → hits, files, entries |
| `web_search` / `fetch_content` / … | query or URL, result count or title |
| `mcp__server__tool` | `server.tool` and the first meaningful argument |
| `spawn` / `send` / `stop` | name · model·thinking; `→ target`; id |
| anything else | tool name, first meaningful argument, `✓`/`✗` |

Rules: file contents, diffs and command output are never shown collapsed, except one line on a
failure. Durations appear for successful calls that took at least 1s. A leading `cd <dir> &&` is
left out of `run` lines (expand to see the full command). Paths
are relative to the working directory, with your home as `~`. Lines are cut to the terminal width,
the target first so the result stays visible. If a tool's arguments or result have an unexpected
shape, the row falls back to the generic line; a renderer error falls back to the tool's own view.

## Spacing

pi draws a blank line above every tool row. For collapsed rows this package removes it, so a run
of tool calls is a block of consecutive lines. That is a small, guarded patch of pi's
`ToolExecutionComponent.render`; set `PI_MSO_TRANSCRIPT_SPACING=1` to keep pi's spacing. Set
`PI_MSO_TRANSCRIPT=0` to disable the transcript part without uninstalling it.

## Run timing

After each agent run, one line shows where the time went: total, model calls (request start to
the end of the reply, with the call count) and tools (wall time with at least one tool running, so
parallel calls count once). It is a custom session entry (`mso-timing`), kept in the session and
never sent to the model. Set `PI_MSO_TIMING=0` to stop recording it; lines already recorded still
show.

## Response policy

The package ships [`policy/mso-policy.md`](policy/mso-policy.md) and adds it to pi's system
prompt as an `<mso_policy>` section on every `before_agent_start`. It changes a section of pi's
structured prompt (`systemPromptOptions.sections`) rather than replacing the whole prompt, so pi
records it as a normal prompt delta.

No duplicates: if the system prompt already contains the policy's managed-block marker
(`BEGIN MANAGED BLOCK: mso-policy`) — for example because your `~/.pi/agent/APPEND_SYSTEM.md` or
a project `.pi/APPEND_SYSTEM.md` includes it — the section is not added. Your copy wins, whatever
its version.

Set `PI_MSO_POLICY=0` to turn the policy off. The transcript renderer is unaffected; likewise
`PI_MSO_TRANSCRIPT=0` turns off only the transcript part.

## Development

```
npm install
npm test            # node --experimental-strip-types --test
npx tsc --noEmit
pi -e ./index.ts    # try it without installing
```

The formatting is pure (`src/format.ts`, no pi imports) and unit-tested; `src/render.ts` turns it
into pi components and handles expansion. `src/policy.ts` decides whether to add the policy
section (pure, tested in `test/policy.test.ts`).

## License

MIT
