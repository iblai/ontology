# Changelog

## [1.3.0](https://github.com/iblai/ontology/compare/v1.2.1...v1.3.0) (2026-11-27)

### Features

* add Google/Microsoft setup steps and guide, save demo servers, require a demo OAuth client ([d9c030c](https://github.com/iblai/ontology/commit/d9c030c40531227bafaf9b66e733d680b353eb1b))
* add Google/Microsoft setup steps and guides, save demo servers, require a demo OAuth client ([78b0bb2](https://github.com/iblai/ontology/commit/78b0bb22873880c00d61709ad6200b6acd39980b))

## [1.2.1](https://github.com/iblai/ontology/compare/v1.2.0...v1.2.1) (2026-11-27)

### Bug Fixes

* name a missing MCP server instead of an invisible 404, refuse demo deploys of new servers ([322e888](https://github.com/iblai/ontology/commit/322e88809d8fb69769e272fb1498202fb968f270))

## [1.2.0](https://github.com/iblai/ontology/compare/v1.1.2...v1.2.0) (2026-11-27)

### Features

* add 23 ready-made API systems with OAuth and logos, fold the connected list, fix pnpm audit ([2ac2808](https://github.com/iblai/ontology/commit/2ac2808958d21cf5fc3f547663d1d4a4fd98e995))

## [1.1.2](https://github.com/iblai/ontology/compare/v1.1.1...v1.1.2) (2026-11-20)

### Chores

* publish each release from the workflow once its install files are attached ([4632e98](https://github.com/iblai/ontology/commit/4632e988bd2a9ab0b28bf0d989ff572839f330e3))

## [1.1.1](https://github.com/iblai/ontology/compare/v1.1.0...v1.1.1) (2026-11-20)

### Bug Fixes

* grant a view instead of columns, say why ask_question's model gave no answer, correct the pool comment ([0c115db](https://github.com/iblai/ontology/commit/0c115db420122c5ca1bf6a8fdab400ee8eabce9c))
* problems found testing MCP servers against a local Canvas LMS ([2ba2dbf](https://github.com/iblai/ontology/commit/2ba2dbf1abc297c426c5aacbe891b4d9613f51d8))

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
