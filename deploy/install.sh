#!/usr/bin/env bash
# ============================================================
# install.sh — the ibl.ai ontology backend on a fresh Ubuntu server
#
#   curl -fsSL https://github.com/iblai/ontology/releases/latest/download/install.sh \
#     | sudo bash -s -- --host <host name>
#
# It asks for no key and no platform. It ends with a link: opened in a browser, the
# frontend asks which platform this server is for and sets it up. Run it again to
# upgrade, or to print the link once more. --uninstall removes it, --dry-run says
# what would happen and changes nothing.
#
# What it leaves on the server: Docker (only if it had to install it), the
# directory /opt/iblai-ontology with compose.yaml and .env, and Docker's volumes
# and images. No language runtime, no source tree, nothing in a home directory,
# no firewall change.
# ============================================================
set -euo pipefail

VERSION="dev"
REPO="https://github.com/iblai/ontology"
DIR="/opt/iblai-ontology"
COMPOSE=(docker compose -f "$DIR/compose.yaml")

# What each value must look like; none lets through a character a shell or a .env file reads as more.
HOST_RE='^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])$'
URL_RE='^https://[A-Za-z0-9._:/-]+$'
# A frontend on a developer's own machine is the one address taken over http.
FRONTEND_RE='^(https://[A-Za-z0-9._:/-]+|http://(localhost|127\.0\.0\.1)(:[0-9]+)?)$'

# The ibl.ai platform's address; --platform-url names another.
PLATFORM_URL="https://api.iblai.app/dm"
# The frontend the link opens; --frontend names another.
FRONTEND="https://ontology.ibl.ai"
HOST=""
# The one-time code of the link that sets this server up.
CODE=""
# Where the settings live: dm (the platform keeps ontology records) or rbac (this server does).
STORE=""
DRY=0
UNINSTALL=0

usage() {
  cat <<EOF
Installs the ibl.ai ontology backend on this server (Ubuntu 22.04 or later, amd64).

  --host <host name>        the name this server answers at, such as ontology.example.edu
  --platform-url <address>  the platform's address, when it is not https://api.iblai.app/dm
  --frontend <address>      the frontend the link opens, when it is not https://ontology.ibl.ai
  --dry-run                 say what would happen; change nothing, ask nothing
  --uninstall               remove the backend, its data and $DIR

A host name not given is asked for. No key and no platform: the install ends with a link,
and the frontend it opens asks which platform this server is for.
Run it again to upgrade, or to print the link again: an existing $DIR/.env is kept and
nothing is asked.
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

secret() { od -An -tx1 -N"$1" /dev/urandom | tr -d ' \n'; }

# The key the logins of the connected systems are encrypted with (Fernet: 32 bytes, URL-safe base64).
fernet_key() { head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '\n'; }

kept() { sed -n "s/^$1=//p" "$DIR/.env" 2>/dev/null || true; }

check_server() {
  local id="" release=""
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
    refuse "the backend's image is built for amd64 (x86_64); this server is $(uname -m)."
  fi
  if ! command -v curl >/dev/null 2>&1; then
    refuse "curl is needed and is not installed: apt-get install -y curl"
  fi
}

ensure_docker() {
  if docker compose version >/dev/null 2>&1; then
    say "Docker with Compose is already here: nothing to install."
    return
  fi
  if command -v docker >/dev/null 2>&1; then
    # Mixing Ubuntu's packages with Docker's own breaks both, so it is not guessed.
    refuse "Docker is installed without Compose. Add the Compose package that matches your Docker (docker-compose-v2 beside Ubuntu's docker.io, docker-compose-plugin beside Docker's own packages), then run this again."
    return
  fi
  say "Installing Docker and Compose from Ubuntu's own archive (docker.io, docker-compose-v2)."
  run env DEBIAN_FRONTEND=noninteractive apt-get update -q
  run env DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends \
    docker.io docker-compose-v2
  run systemctl enable --now docker
}

# One read from the platform: its answer, then its HTTP status on a last line.
platform_get() { # platform_get <path>
  # No key: a token that is none makes the platform itself refuse, in its own words.
  curl -sS --max-time 30 -w '\n%{http_code}' -H 'Authorization: Token x' "$PLATFORM_URL$1"
}

# The platform's own refusals say why in "detail"; one without it comes from the edge in front of it.
from_the_platform() { # from_the_platform <status> <words>
  [[ "$2" == *'"detail"'* ]] ||
    stop "the platform's edge refused this server (HTTP $1: ${2:0:200}). Its network is not let through to $PLATFORM_URL: ask ibl.ai to allow this server's address, then run this again. Nothing was installed."
}

# Two reads with no key before anything is installed: does this server reach the platform,
# and does the platform keep ontology records.
check_platform() {
  local reach="/api/core/token/verify/"
  local records="/v1/ontology/kinds/backend/records?page_size=1"
  local answer status words
  if [ "$DRY" = 1 ]; then
    say "  would ask the platform, with no key: GET $PLATFORM_URL$reach"
    say "  would ask it where the settings live: GET $PLATFORM_URL$records"
    STORE="<dm or rbac>"
    return
  fi

  if ! answer=$(platform_get "$reach"); then
    stop "no answer from the platform at $PLATFORM_URL. Nothing was installed."
  fi
  status=${answer##*$'\n'}
  words=${answer%$'\n'*}
  case "$status" in
    401 | 403) from_the_platform "$status" "$words" ;;
    404) stop "$PLATFORM_URL does not answer as an ibl.ai platform: check the address. Nothing was installed." ;;
    *) stop "the platform answered HTTP $status: ${words:0:200} Nothing was installed." ;;
  esac
  say "This server reaches the platform."

  if ! answer=$(platform_get "$records"); then
    stop "no answer from the platform at $PLATFORM_URL. Nothing was installed."
  fi
  status=${answer##*$'\n'}
  words=${answer%$'\n'*}
  case "$status" in
    404)
      STORE=rbac
      say "This platform keeps no ontology records yet: the connected systems and the schedules will"
      say "live on this server. The roles still live in the platform."
      ;;
    # A route that is there wants a key before it says more.
    200 | 401 | 403)
      [ "$status" = 200 ] || from_the_platform "$status" "$words"
      STORE=dm
      say "The platform keeps ontology records: the connected systems and the schedules will live there."
      ;;
    *) stop "the platform answered HTTP $status about its ontology records: ${words:0:200} Nothing was installed." ;;
  esac
}

settings() {
  if [ -f "$DIR/.env" ]; then
    HOST=$(kept ONTOLOGY_HOST)
    [ -n "$HOST" ] || refuse "$DIR/.env names no ONTOLOGY_HOST."
    STORE=$(kept ONTOLOGY_DATA_STORE)
    [ -n "$STORE" ] || refuse "$DIR/.env names no ONTOLOGY_DATA_STORE."
    CODE=$(kept ONTOLOGY_SETUP_CODE)
    say "$DIR/.env is here: this is an upgrade. Its settings are kept and nothing is asked."
    return
  fi
  if [ "$DRY" = 1 ]; then
    say "  would ask for the host name if it is not given"
  else
    [ -n "$HOST" ] || ask HOST "Host name of this server (such as ontology.example.edu)"
  fi
  PLATFORM_URL=${PLATFORM_URL%/}
  HOST=${HOST,,}
  [[ "$PLATFORM_URL" =~ $URL_RE ]] ||
    refuse "--platform-url is an https address, such as https://api.iblai.app/dm."
  # A dry run judges what was given; a real one has the host name by now.
  if [ -n "$HOST" ] || [ "$DRY" != 1 ]; then
    valid_host "$HOST" ||
      refuse "--host is a full host name that points to this server, such as ontology.example.edu."
  fi
  check_platform
  if [ "$DRY" = 1 ]; then
    HOST=${HOST:-<host name>}
    CODE="<code>"
    say "Writing $DIR/.env (readable by root alone)."
    say "  would write: ONTOLOGY_HOST, IBLAI_BASE_URL, ONTOLOGY_DATA_STORE, ONTOLOGY_SETUP_CODE and four generated secrets"
    return
  fi
  CODE=$(secret 16)

  say "Writing $DIR/.env (readable by root alone)."
  mkdir -p "$DIR"
  (
    umask 077
    cat >"$DIR/.env" <<EOF
# The ibl.ai ontology backend: settings of this server, read by compose.yaml beside it.
# Keep a copy somewhere safe. ONTOLOGY_CREDENTIAL_KEY decrypts the logins of the connected
# systems and this server's own platform key: without it they must be entered again.
# ONTOLOGY_DATA_STORE was chosen at install and is not changed by an upgrade: dm when the
# ibl.ai platform keeps ontology records, rbac when this server keeps them and only the
# roles are the platform's.
# ONTOLOGY_SETUP_CODE is the code of the link that sets this server up for a platform.
# The platform and the key it is set up with are kept in the server's database, not here.
ONTOLOGY_HOST=$HOST
IBLAI_BASE_URL=$PLATFORM_URL
ONTOLOGY_DATA_STORE=$STORE
ONTOLOGY_SETUP_CODE=$CODE
ONTOLOGY_DB_PASSWORD=$(secret 24)
CHROMA_TOKEN=$(secret 24)
ONTOLOGY_SECRET_KEY=$(secret 48)
ONTOLOGY_CREDENTIAL_KEY=$(fernet_key)
EOF
  )
}

fetch() {
  say "Getting compose.yaml of version $VERSION and the images."
  run curl -fsSL -o "$DIR/compose.yaml" "$REPO/releases/download/v$VERSION/compose.yaml"
  run "${COMPOSE[@]}" pull --quiet
}

start() {
  local deadline status=""
  say "Starting the backend."
  if ! run "${COMPOSE[@]}" up --detach --remove-orphans; then
    "${COMPOSE[@]}" logs --tail 25 migrate ontology-gateway || true
    stop "the backend did not start: its last lines are above. $DIR is left as it is; run this again once the cause is gone."
  fi
  if [ "$DRY" = 1 ]; then
    say "  would wait up to 3 minutes for https://$HOST/mcp to answer 405"
    return
  fi
  say "Waiting for https://$HOST/mcp: the certificate comes first (up to 3 minutes)."
  deadline=$((SECONDS + 180))
  until [ "$status" = 405 ]; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      "${COMPOSE[@]}" logs --tail 25 proxy ontology-gateway || true
      stop "https://$HOST/mcp did not answer in 3 minutes: the last lines of the proxy and the gateway are above. Check that $HOST points to this server and that ports 80 and 443 are open to the internet, then run this again."
    fi
    sleep 5
    status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "https://$HOST/mcp" || true)
  done
}

finish() {
  local where="in the ibl.ai platform" state=""
  if [ "$STORE" = rbac ]; then
    where="on this server; only the roles are in the ibl.ai platform"
  fi
  if [ "$DRY" != 1 ]; then
    # Anyone may ask a server whether it is set up.
    state=$(curl -s --max-time 10 "https://$HOST/setup" || true)
  fi
  say ""
  say "The ontology backend is running (version $VERSION)."
  say ""
  if [[ "${state// /}" == *'"set_up":true'* ]]; then
    say "  This server is set up: manage it in the frontend, at $FRONTEND"
  elif [ -n "$CODE" ]; then
    say "  Open this to finish (works once):"
    say "  $FRONTEND/#host=$HOST&code=$CODE"
    say ""
    say "  It asks you to sign in to ibl.ai and to choose the platform this server is for."
    say "  Lost it? Run the install command again."
  fi
  cat <<EOF

  The address agents call:   https://$HOST/mcp

  Its two files:   $DIR/compose.yaml
                   $DIR/.env
  Keep a copy of .env somewhere safe: its key decrypts the logins of the connected systems.
  The connected systems and the schedules live $where.

  Logs:      docker compose -f $DIR/compose.yaml logs --follow
  Upgrade:   run the install command again
  Remove:    run it with --uninstall
EOF
}

uninstall() {
  local host confirm typed=""
  if [ ! -f "$DIR/compose.yaml" ] || [ ! -f "$DIR/.env" ]; then
    refuse "no backend is installed in $DIR."
  fi
  host=$(kept ONTOLOGY_HOST)
  STORE=$(kept ONTOLOGY_DATA_STORE)
  confirm=${host:-remove}
  say "This removes the backend${host:+ at $host}: its containers and images, the synced copy of your"
  say "systems' data, the memory files, the search index, the audit log, and $DIR with the key"
  say "that decrypts the logins of the connected systems."
  if [ "$STORE" = rbac ]; then
    say "The connected systems, the schedules and the list of connected agents live on this server"
    say "and go with it: remove each agent's connection in the frontend first, so its key is deleted."
  fi
  if [ "$DRY" = 1 ]; then
    say "  would ask for \"$confirm\" to be typed"
  else
    ask typed "Type $confirm to go on"
    [ "$typed" = "$confirm" ] || stop "that is not $confirm. Nothing was removed."
  fi
  run "${COMPOSE[@]}" down --volumes --rmi all --remove-orphans
  run rm -rf "$DIR"
  cat <<EOF

Removed. Still in place:
  - Docker. If this script installed it: apt-get remove --purge docker.io docker-compose-v2
  - What the ibl.ai platform keeps: the roles, the key and the MCP server of each agent that
    was still connected, and whatever else it kept for this backend. The backend's own API
    key still works until you delete it in the platform.
EOF
}

main() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --platform-url | --host | --frontend)
        [ $# -ge 2 ] || stop "$1 needs a value."
        case "$1" in
          --platform-url) PLATFORM_URL=$2 ;;
          --host) HOST=$2 ;;
          --frontend) FRONTEND=$2 ;;
        esac
        shift 2
        ;;
      --platform) stop "--platform is no longer taken: the platform is chosen in the frontend, when the link this install prints is opened." ;;
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
  FRONTEND=${FRONTEND%/}
  [[ "$FRONTEND" =~ $FRONTEND_RE ]] ||
    refuse "--frontend is the frontend's address, such as https://ontology.ibl.ai."
  check_server
  ensure_docker
  settings
  fetch
  start
  finish
}

# Last line on purpose: a download cut short runs nothing.
main "$@"
