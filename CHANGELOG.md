# Changelog

## [1.1.0](https://github.com/iblai/ontology/compare/v1.0.1...v1.1.0) (2026-11-20)

### Features

* add the Filesystem source (local://), a local run without Caddy, the scheme fix, CLAUDE.md ([e2e85ab](https://github.com/iblai/ontology/commit/e2e85ab09a172335c8f9aa46708d071f6576e86c))
* read the home folder in the dev guide, keep the Filesystem picker on screen and restyle it ([b3f03ba](https://github.com/iblai/ontology/commit/b3f03bad78287359f717bde68d712fd4b021af52))

### Documentation

* turn the local guide into dev_local.md, run from the checkout with its files git-ignored ([f1148e0](https://github.com/iblai/ontology/commit/f1148e0c5b26e7c48f0b707adc5242d3ecc7343f))

## [1.0.1](https://github.com/iblai/ontology/compare/v1.0.0...v1.0.1) (2026-11-20)

### Bug Fixes

* apt-get command for docker compose ([269127b](https://github.com/iblai/ontology/commit/269127babcccd021362adc4bb56aedd69f48b92f))

## 1.0.0

The first release of the ontology console, which takes the place of the 0.2.x backend.

### Features

- the console in the ibl.ai shell, wired to a host layer and an MCP gateway per platform
- Docker Compose as the install: the console, NVIDIA auto-ontology as its engine, and Caddy, on one server
- one platform per server (`ONTOLOGY_PLATFORM`), an engine key the server makes itself, and a model route for the engine through an OpenAI key
