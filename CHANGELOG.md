# Changelog

## 1.0.0

The first release of the ontology console, which takes the place of the 0.2.x backend.

### Features

- the console in the ibl.ai shell, wired to a host layer and an MCP gateway per platform
- Docker Compose as the install: the console, NVIDIA auto-ontology as its engine, and Caddy, on one server
- one platform per server (`ONTOLOGY_PLATFORM`), an engine key the server makes itself, and a model route for the engine through an OpenAI key
