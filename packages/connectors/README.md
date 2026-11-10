# Connectors

Platform adapters behind a stable `SocialDataSource` interface. The governance
plane never talks to RedFox, OneAPI, or a native API directly — it talks to this
interface.

Adding a connector:

1. Implement `SocialDataSource` from `src/connectors/base.py`.
2. Register it in `src/connectors/__init__.py`.
3. Add a test under `tests/` using recorded fixtures.
