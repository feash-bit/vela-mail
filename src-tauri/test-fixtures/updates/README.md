Test fixtures for the self-updater tests (`src/tests.rs`).

- `test.key.pub` — public half of a throwaway key used ONLY for these tests.
  It is not, and must never be, the release key.
- `*.tar.gz` / `*.sig` — tiny fake releases signed with that test key using
  `tauri signer sign`.
- `attacker.sig` — the 0.2.0 archive signed with an unrelated key.
