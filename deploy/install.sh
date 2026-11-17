#!/usr/bin/env bash
# ============================================================
# install.sh — the ibl.ai ontology console on a fresh Ubuntu server
#
#   curl -fsSL https://github.com/iblai/ontology/releases/latest/download/install.sh \
#     | sudo bash -s -- --host <host name> --platform <platform key>
#
# Optional: a convenience on top of the release's compose.yaml. It checks the server, installs
# Docker, Compose, buildx and git if Docker is missing, puts compose.yaml and a .env with the
# names it was given in /opt/iblai-ontology, starts it, and waits for the console. Run it again
# to upgrade. --uninstall removes it, --dry-run says what would happen and changes nothing.
#
# What it leaves on the server: Docker (only if it had to install it), the directory
# /opt/iblai-ontology with compose.yaml and .env, and Docker's volumes and images. No secret
# is written by this script, nothing in a home directory, no firewall change.
# ============================================================
set -euo pipefail

VERSION="dev"
REPO="https://github.com/iblai/ontology"
DIR="/opt/iblai-ontology"
COMPOSE=(docker compose -f "$DIR/compose.yaml")

# What each value must look like; none lets through a character a shell or a .env file reads as more.
HOST_RE='^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])$'
URL_RE='^https://[A-Za-z0-9._:/-]+$'
PLATFORM_RE='^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'

# Empty means not given: what .env keeps stays, else compose's default.
PLATFORM=""
PLATFORM_URL=""
HOST=""
DRY=0
UNINSTALL=0

usage() {
  cat <<EOF
Installs the ibl.ai ontology console on this server (Ubuntu 22.04 or later, x86_64).

  --platform <key>          the ibl.ai platform this server serves, such as acme-university
  --host <host name>        the name this server answers at, such as ontology.example.edu
  --platform-url <address>  the platform's address, when it is not https://api.iblai.app/dm
  --dry-run                 say what would happen; change nothing, ask nothing
  --uninstall               remove the console, its data and $DIR

A platform not given is asked for. Without --host the console answers at https://localhost,
on this server only. Run it again to upgrade: $DIR/.env keeps what was given, and --host or
--platform-url given again replaces it. An installed server keeps its platform.
EOF
}

say() { printf '%s\n' "$*"; }

stop() {
  printf 'install.sh: %s\n' "$*" >&2
  exit 1
}

# What stops an install is only said in a dry run, so the rest can still be read.
refuse() {
  if [ "$DRY" = 1 ]; then
    say "  would stop here: $*"
  else
    stop "$@"
  fi
}

run() {
  if [ "$DRY" = 1 ]; then
    say "  would run: $*"
  else
    "$@"
  fi
}

# Asked on the terminal itself: under "curl | bash" the script is what arrives on stdin.
ask() { # ask <variable> <question>
  local answer=""
  if ! { : </dev/tty; } 2>/dev/null; then
    stop "there is no terminal to ask on. Wanted: $2"
  fi
  read -r -p "$2: " answer </dev/tty
  printf -v "$1" '%s' "$answer"
}

valid_host() { [ "${#1}" -le 253 ] && [[ "$1" =~ $HOST_RE ]]; }

kept() { sed -n "s/^$1=//p" "$DIR/.env" 2>/dev/null || true; }

# Replaces one line of .env, or adds it; every other line is left as it is.
put() { # put <name> <value>
  if [ "$DRY" = 1 ]; then
    say "  would write $1=$2 into $DIR/.env"
    return
  fi
  (
    umask 077
    {
      [ ! -f "$DIR/.env" ] || grep -v "^$1=" "$DIR/.env" || true
      printf '%s=%s\n' "$1" "$2"
    } >"$DIR/.env.new"
    mv "$DIR/.env.new" "$DIR/.env"
  )
}

# Kilobytes as gigabytes, one decimal.
gb() { awk -v k="$1" 'BEGIN { printf "%.1f", k / 1048576 }'; }

# The older ontology backend (v0.2.x) used the same directory; this one cannot take its place.
refuse_older() {
  if [ -n "$(kept ONTOLOGY_DB_PASSWORD)" ] || grep -qs ontology-gateway "$DIR/compose.yaml"; then
    refuse "$DIR holds the older ibl.ai ontology backend. Remove it first with the installer that put it there: curl -fsSL $REPO/releases/download/v0.2.13/install.sh | sudo bash -s -- --uninstall. Nothing was installed."
  fi
}

check_server() {
  local id="" release="" tool port where free mem
  if [ "$(id -u)" != 0 ]; then
    refuse "run it as root, with sudo."
  fi
  if [ -r /etc/os-release ]; then
    # shellcheck source=/dev/null
    id=$(. /etc/os-release && printf '%s' "${ID:-}")
    # shellcheck source=/dev/null
    release=$(. /etc/os-release && printf '%s' "${VERSION_ID:-}")
  fi
  if [ "$id" != ubuntu ] || ! dpkg --compare-versions "$release" ge 22.04; then
    refuse "this installs on Ubuntu 22.04 or later; this server runs ${id:-an unknown system} ${release}."
  fi
  if [ "$(uname -m)" != x86_64 ]; then
    refuse "the console's image and NVIDIA's engine are built for amd64 (x86_64); this server is $(uname -m)."
  fi
  for tool in curl:curl ss:iproute2; do
    if ! command -v "${tool%%:*}" >/dev/null 2>&1; then
      refuse "${tool%%:*} is needed and is not installed: apt-get install -y ${tool#*:}"
    fi
  done
  refuse_older
  # An upgrade finds its own services on these ports and its own images on the disk.
  if [ -f "$DIR/compose.yaml" ] || [ -f "$DIR/.env" ]; then
    return 0
  fi

  # The services run on the host's network: a port already taken stops one of them.
  for port in 80 443 3000 3001 3002 3100 5434; do
    if [ -n "$(ss -ltnH "sport = :$port")" ]; then
      refuse "port $port is already in use on this server. The console's services listen on 80, 443, 3000, 3001, 3002, 3100 and 5434: stop what holds $port, then run this again. Nothing was installed."
    fi
  done
  # NVIDIA's engine is built on this server, which takes room and memory.
  where=/var/lib
  [ ! -d /var/lib/docker ] || where=/var/lib/docker
  free=$(df -Pk "$where" | awk 'NR == 2 { print $4 }')
  if [ "$free" -lt 15728640 ]; then
    refuse "there is $(gb "$free") GB free in $where; building and running the engine needs at least 15 GB. Nothing was installed."
  fi
  mem=$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)
  if [ "$mem" -lt 3670016 ]; then
    refuse "this server has $(gb "$mem") GB of memory; building the engine needs 4 GB. Nothing was installed."
  fi
}

ensure_docker() {
  local found
  if docker compose version >/dev/null 2>&1; then
    say "Docker with Compose is already here."
    if ! docker buildx version >/dev/null 2>&1; then
      # Mixing Ubuntu's packages with Docker's own breaks both, so it is not guessed.
      refuse "Docker is installed without buildx, which building NVIDIA's engine needs. Add the package that matches your Docker (docker-buildx beside Ubuntu's docker.io, docker-buildx-plugin beside Docker's own packages), then run this again."
    fi
    # Docker builds NVIDIA's services from its git address, which takes git on the server.
    if ! command -v git >/dev/null 2>&1; then
      say "Installing git from Ubuntu's own archive."
      run env DEBIAN_FRONTEND=noninteractive apt-get update -q
      run env DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends git
    fi
  elif command -v docker >/dev/null 2>&1; then
    refuse "Docker is installed without Compose. Add the Compose package that matches your Docker (docker-compose-v2 beside Ubuntu's docker.io, docker-compose-plugin beside Docker's own packages), then run this again."
    return
  else
    say "Installing Docker, Compose, buildx and git from Ubuntu's own archive (docker.io, docker-compose-v2, docker-buildx, git)."
    run env DEBIAN_FRONTEND=noninteractive apt-get update -q
    run env DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends \
      docker.io docker-compose-v2 docker-buildx git
    run systemctl enable --now docker
  fi
  if [ "$DRY" = 1 ] && ! docker compose version >/dev/null 2>&1; then
    say "  would check that Compose is 2.23.1 or later"
    return
  fi
  # compose.yaml carries Caddy's settings inline, which needs Compose 2.23.1.
  found=$(docker compose version --short 2>/dev/null || true)
  found=${found#v}
  if [ -z "$found" ] || ! dpkg --compare-versions "$found" ge 2.23.1; then
    refuse "Docker Compose ${found:-of an unknown version} is here; this needs 2.23.1 or later. Upgrade the Compose package, then run this again."
  fi
}

settings() {
  local was=""
  if [ -f "$DIR/.env" ]; then
    say "$DIR/.env is here: this is an upgrade. What it holds is kept; --host or --platform-url given replaces it."
    was=$(kept ONTOLOGY_PLATFORM)
    # The engine's data is one platform's: another platform is never handed it.
    if [ -n "$was" ] && [ -n "$PLATFORM" ] && [ "$PLATFORM" != "$was" ]; then
      refuse "this server already serves the platform $was, and its engine holds that platform's systems. To serve $PLATFORM instead, remove this install first (--uninstall), then install again. Nothing was changed."
    fi
    PLATFORM=${PLATFORM:-$was}
    HOST=${HOST:-$(kept ONTOLOGY_HOST)}
  fi
  if [ -z "$PLATFORM" ] && [ "$DRY" = 1 ]; then
    say "  would ask for the platform's key"
    PLATFORM="<platform>"
  else
    [ -n "$PLATFORM" ] || ask PLATFORM "Key of the ibl.ai platform this server serves (such as acme-university)"
    [[ "$PLATFORM" =~ $PLATFORM_RE ]] ||
      refuse "--platform is the platform's key: letters, digits, dots, dashes and underscores, such as acme-university."
  fi
  if [ -n "$HOST" ] && ! valid_host "$HOST"; then
    refuse "--host is a full host name that points to this server, such as ontology.example.edu."
  fi

  say "Writing the settings into $DIR/.env (readable by root alone)."
  run mkdir -p "$DIR"
  put ONTOLOGY_PLATFORM "$PLATFORM"
  [ -z "$HOST" ] || put ONTOLOGY_HOST "$HOST"
  [ -z "$PLATFORM_URL" ] || put ONTOLOGY_DM_URL "$PLATFORM_URL"
  if [ -z "$HOST" ]; then
    say "No --host: the console answers at https://localhost, from this server only, with Caddy's own certificate. Run this again with --host <name> to serve it to others."
  fi
}

fetch() {
  say "Getting compose.yaml of version $VERSION."
  # Downloaded beside the old copy, which is replaced only once the new one is whole.
  run curl -fsSL -o "$DIR/compose.yaml.new" "$REPO/releases/download/v$VERSION/compose.yaml"
  run mv "$DIR/compose.yaml.new" "$DIR/compose.yaml"
}

build() {
  local attempt
  # NVIDIA's base image comes from nvcr.io, whose pulls have timed out before.
  for attempt in 1 2 3; do
    say "Building NVIDIA's services (attempt $attempt of 3; the first build takes several minutes)."
    if run "${COMPOSE[@]}" build; then
      return
    fi
    [ "$attempt" -lt 3 ] ||
      stop "NVIDIA's services did not build in three attempts: Docker's output is above. If it ends in a timeout at nvcr.io, run docker pull nvcr.io/nvidia/base/ubuntu:jammy-20250619, then run this again. $DIR is left as it is."
    sleep 20
  done
}

start() {
  local deadline status="" url how
  say "Starting the console, NVIDIA's engine and Caddy."
  if ! run "${COMPOSE[@]}" up --detach --remove-orphans; then
    "${COMPOSE[@]}" ps --all || true
    "${COMPOSE[@]}" logs --tail 25 || true
    stop "the services did not start: their state and last lines are above. $DIR is left as it is; run this again once the cause is gone."
  fi
  url="https://${HOST:-localhost}/api/host/health"
  if [ "$DRY" = 1 ]; then
    say "  would wait up to 5 minutes for $url to answer 200"
    return
  fi
  # Asked on this machine's own address: not every network lets a server reach its public one.
  how=(--resolve "$HOST:443:127.0.0.1")
  # Caddy's own certificate for localhost is trusted by no one, curl included.
  [ -n "$HOST" ] || how=(--insecure)
  say "Waiting for $url (up to 5 minutes; with a host name, the certificate comes first)."
  deadline=$((SECONDS + 300))
  until [ "$status" = 200 ]; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      "${COMPOSE[@]}" logs --tail 25 proxy ontology || true
      stop "$url did not answer in 5 minutes (last answer: HTTP ${status:-none}): the last lines of Caddy and the console are above. HTTP 503 names a setting the console lacks. No answer at all: check that ${HOST:-the host name} points to this server and that ports 80 and 443 are open to the internet, then run this again."
    fi
    sleep 5
    status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${how[@]}" "$url" || true)
  done
}

finish() {
  local host=${HOST:-localhost}
  say ""
  say "The ontology console is running (version $VERSION), serving the platform $PLATFORM."
  cat <<EOF

  The console:              https://$host/
  The address agents call:  https://$host/$PLATFORM/<server>/mcp
  NVIDIA's API:             https://$host/api/...

  One step left, on ibl.ai: add https://$host to the platform's allowed redirect origins.
  Sign-in returns to no other address. Then sign in at https://$host/.

  NVIDIA's own pages are not on the internet. From your computer:
    ssh -L 3100:127.0.0.1:3100 <this server>
  then open http://localhost:3100 and sign in as admin@ontology.local. Its password:
    cd $DIR && sudo docker compose exec ontology cat /secrets/admin-password
EOF
  if ! grep -qs '^OPENAI_API_KEY=.' "$DIR/.env"; then
    cat <<EOF

  No model is set: the engine names terms from table and column names, infers no joins and
  answers no questions. To turn them on, add OPENAI_API_KEY=<key> to $DIR/.env, then
    cd $DIR && sudo docker compose up -d
EOF
  fi
  cat <<EOF

  Its files:  $DIR/compose.yaml   (an upgrade replaces it: set things in .env)
              $DIR/.env           (the settings; add your own lines there)
  The data lives in the Docker volumes of the project iblai-ontology-console.

  In $DIR:
    Logs:     sudo docker compose logs --follow ontology
    Restart:  sudo docker compose restart
  Upgrade:    curl -fsSL $REPO/releases/latest/download/install.sh | sudo bash
  Remove:     curl -fsSL $REPO/releases/latest/download/install.sh | sudo bash -s -- --uninstall
EOF
}

uninstall() {
  local host confirm typed=""
  refuse_older
  if [ ! -f "$DIR/compose.yaml" ] && [ ! -f "$DIR/.env" ]; then
    refuse "no ontology console is installed in $DIR."
  fi
  host=$(kept ONTOLOGY_HOST)
  confirm=${host:-remove}
  say "This removes the ontology console${host:+ at $host}: its containers and images, NVIDIA's engine"
  say "with its database (the systems it reads, its terms and what was certified, its users and"
  say "keys), the console's files (the MCP servers deployed on it, their revisions and logs), the"
  say "generated secrets, the certificate, and $DIR with compose.yaml and .env."
  say "Remove each agent's connection in the console first, so its key is deleted."
  if [ "$DRY" = 1 ]; then
    say "  would ask for \"$confirm\" to be typed"
  else
    ask typed "Type $confirm to go on"
    [ "$typed" = "$confirm" ] || stop "that is not $confirm. Nothing was removed."
  fi
  # An install stopped before compose.yaml arrived started nothing.
  if [ -f "$DIR/compose.yaml" ]; then
    run "${COMPOSE[@]}" down --volumes --rmi all --remove-orphans
  else
    say "$DIR holds no compose.yaml: no container was started from it."
  fi
  run rm -rf "$DIR"
  cat <<EOF

Removed. Still in place:
  - Docker and git. If this script installed them:
    apt-get remove --purge docker.io docker-compose-v2 docker-buildx git
  - What the ibl.ai platform keeps: the key and the MCP server of each agent that was still
    connected, and https://${host:-localhost} among its allowed redirect origins. Remove them there.
EOF
}

main() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --platform | --platform-url | --host)
        [ $# -ge 2 ] || stop "$1 needs a value."
        case "$1" in
          --platform) PLATFORM=$2 ;;
          --platform-url) PLATFORM_URL=${2%/} ;;
          --host) HOST=${2,,} ;;
        esac
        shift 2
        ;;
      --dry-run)
        DRY=1
        shift
        ;;
      --uninstall)
        UNINSTALL=1
        shift
        ;;
      -h | --help)
        usage
        exit 0
        ;;
      *) stop "unknown option $1 (see --help)." ;;
    esac
  done
  if [ "$DRY" = 1 ]; then
    say "Dry run: nothing is changed and nothing is asked."
  fi

  if [ "$UNINSTALL" = 1 ]; then
    if [ "$(id -u)" != 0 ]; then
      refuse "run it as root, with sudo."
    fi
    uninstall
    return
  fi
  # The release workflow writes the version above; a copy from the source tree has none to install.
  if [ "$VERSION" = dev ]; then
    refuse "this copy of install.sh is not from a release. Use $REPO/releases/latest/download/install.sh"
  fi
  if [ -n "$PLATFORM_URL" ] && ! [[ "$PLATFORM_URL" =~ $URL_RE ]]; then
    refuse "--platform-url is an https address, such as https://api.iblai.app/dm."
  fi
  check_server
  ensure_docker
  settings
  fetch
  build
  start
  finish
}

# Last line on purpose: a download cut short runs nothing.
main "$@"
