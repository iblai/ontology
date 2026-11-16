#!/usr/bin/env bash
# ============================================================
# install.sh — an ibl.ai ontology server on a fresh Ubuntu server
#
#   curl -fsSL https://github.com/iblai/ontology/releases/latest/download/install.sh \
#     | sudo bash -s -- --host <host name>
#
# It builds NVIDIA's auto-ontology engine here, starts it beside the ibl.ai server half
# and Caddy, and ends with a link: opened in a browser, the console makes this server
# the ontology server of the platform you are signed in to. Run it again to upgrade, or
# to print the link once more. --uninstall removes it, --dry-run says what would happen
# and changes nothing.
#
# What it leaves on the server: Docker (only if it had to install it), the directory
# /opt/iblai-ontology with .env, two compose files and NVIDIA's source, and Docker's
# volumes and images. Nothing in a home directory, no firewall change.
# ============================================================
set -euo pipefail

VERSION="dev"
REPO="https://github.com/iblai/ontology"
DIR="/opt/iblai-ontology"
# NVIDIA's auto-ontology at the commit this release was proven with.
ENGINE_SHA="22e22c894df8cde7a78f854ea40476a8577e9a3d"
COMPOSE=(docker compose --env-file "$DIR/.env" -f "$DIR/engine/docker-compose.yml"
  -f "$DIR/auto-ontology.override.yml" -f "$DIR/server.yml")

# What each value must look like; none lets through a character a shell or a .env file reads as more.
HOST_RE='^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])$'
URL_RE='^https://[A-Za-z0-9._:/-]+$'
# A console on a developer's own machine is the one address taken over http.
FRONTEND_RE='^(https://[A-Za-z0-9._:/-]+|http://(localhost|127\.0\.0\.1)(:[0-9]+)?)$'
KEY_RE='^auto_ontology_[A-Za-z0-9_-]+$'

# The ibl.ai platform's address; --platform-url names another.
PLATFORM_URL="https://api.iblai.app/dm"
# The console the link opens; --frontend names another.
FRONTEND="https://ontology.ibl.ai"
HOST=""
# The one-time code of the link that sets this server up.
CODE=""
DRY=0
UNINSTALL=0

usage() {
  cat <<EOF
Installs an ibl.ai ontology server on this server (Ubuntu 22.04 or later, x86_64).

  --host <host name>        the name this server answers at, such as ontology.example.edu
  --frontend <address>      the console the link opens, when it is not https://ontology.ibl.ai
  --platform-url <address>  the platform's address, when it is not https://api.iblai.app/dm
  --dry-run                 say what would happen; change nothing, ask nothing
  --uninstall               remove the server, its data and $DIR

A host name not given is asked for. No key: the install ends with a link, and the console
it opens makes this server the ontology server of the platform you are signed in to.
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

# Hex only: the database password is pasted into connection URLs unencoded.
secret() { od -An -tx1 -N"$1" /dev/urandom | tr -d ' \n'; }

kept() { sed -n "s/^$1=//p" "$DIR/.env" 2>/dev/null || true; }

# Kilobytes as gigabytes, one decimal.
gb() { awk -v k="$1" 'BEGIN { printf "%.1f", k / 1048576 }'; }

# The older ontology backend lives in the same directory; this one cannot take its place.
refuse_older() {
  if [ -f "$DIR/compose.yaml" ] || [ -n "$(kept ONTOLOGY_DB_PASSWORD)" ]; then
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
    refuse "the server's image and its runtime are built for amd64 (x86_64); this server is $(uname -m)."
  fi
  for tool in curl:curl tar:tar ss:iproute2; do
    if ! command -v "${tool%%:*}" >/dev/null 2>&1; then
      refuse "${tool%%:*} is needed and is not installed: apt-get install -y ${tool#*:}"
    fi
  done
  refuse_older
  # An upgrade finds its own services on these ports and its own images on the disk.
  [ ! -f "$DIR/.env" ] || return 0

  # The services run on the host's network: a port already taken stops one of them.
  for port in 80 443 3000 3001 3002 3100 5434; do
    if [ -n "$(ss -ltnH "sport = :$port")" ]; then
      refuse "port $port is already in use on this server. The ontology server's services listen on 80, 443, 3000, 3001, 3002, 3100 and 5434: stop what holds $port, then run this again. Nothing was installed."
    fi
  done
  # The engine is built on this server, which takes room and memory.
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
    say "Docker with Compose is already here: nothing to install."
    if ! docker buildx version >/dev/null 2>&1; then
      # Mixing Ubuntu's packages with Docker's own breaks both, so it is not guessed.
      refuse "Docker is installed without buildx, which building the engine needs. Add the package that matches your Docker (docker-buildx beside Ubuntu's docker.io, docker-buildx-plugin beside Docker's own packages), then run this again."
    fi
  elif command -v docker >/dev/null 2>&1; then
    refuse "Docker is installed without Compose. Add the Compose package that matches your Docker (docker-compose-v2 beside Ubuntu's docker.io, docker-compose-plugin beside Docker's own packages), then run this again."
    return
  else
    say "Installing Docker, Compose and buildx from Ubuntu's own archive (docker.io, docker-compose-v2, docker-buildx)."
    run env DEBIAN_FRONTEND=noninteractive apt-get update -q
    run env DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends \
      docker.io docker-compose-v2 docker-buildx
    run systemctl enable --now docker
  fi
  if [ "$DRY" = 1 ] && ! docker compose version >/dev/null 2>&1; then
    say "  would check that Compose is 2.24.4 or later"
    return
  fi
  # The override file's !reset needs Compose 2.24.4.
  found=$(docker compose version --short 2>/dev/null || true)
  found=${found#v}
  if [ -z "$found" ] || ! dpkg --compare-versions "$found" ge 2.24.4; then
    refuse "Docker Compose ${found:-of an unknown version} is here; this needs 2.24.4 or later. Upgrade the Compose package, then run this again."
  fi
}

# One read from the platform with no key: a token that is none makes the platform itself refuse.
check_platform() {
  local reach="/api/core/token/verify/"
  local answer status words
  if [ "$DRY" = 1 ]; then
    say "  would ask the platform, with no key: GET $PLATFORM_URL$reach"
    return
  fi
  if ! answer=$(curl -sS --max-time 30 -w '\n%{http_code}' -H 'Authorization: Token x' "$PLATFORM_URL$reach"); then
    stop "no answer from the platform at $PLATFORM_URL. Nothing was installed."
  fi
  status=${answer##*$'\n'}
  words=${answer%$'\n'*}
  case "$status" in
    # The platform's own refusals say why in "detail"; one without it comes from the edge in front of it.
    401 | 403)
      [[ "$words" == *'"detail"'* ]] ||
        stop "the platform's edge refused this server (HTTP $status: ${words:0:200}). Its network is not let through to $PLATFORM_URL: ask ibl.ai to allow this server's address, then run this again. Nothing was installed."
      ;;
    404) stop "$PLATFORM_URL does not answer as an ibl.ai platform: check the address. Nothing was installed." ;;
    *) stop "the platform answered HTTP $status: ${words:0:200} Nothing was installed." ;;
  esac
  say "This server reaches the platform."
}

settings() {
  local before
  if [ -f "$DIR/.env" ]; then
    before=$(kept ONTOLOGY_HOST)
    if [ -n "$HOST" ] && [ "$HOST" != "$before" ]; then
      refuse "this server was installed as $before, and --host names $HOST. An upgrade keeps the host name in $DIR/.env: leave --host out, or remove the server first to install it under another name. Nothing was changed."
    fi
    HOST=$before
    FRONTEND=$(kept ONTOLOGY_FRONTEND)
    PLATFORM_URL=$(kept ONTOLOGY_DM_URL)
    CODE=$(kept ONTOLOGY_SETUP_CODE)
    if [ -z "$HOST" ] || [ -z "$FRONTEND" ] || [ -z "$PLATFORM_URL" ] || [ -z "$CODE" ]; then
      refuse "$DIR/.env lacks one of ONTOLOGY_HOST, ONTOLOGY_FRONTEND, ONTOLOGY_DM_URL and ONTOLOGY_SETUP_CODE. Put it back from your copy of .env, then run this again."
    fi
    say "$DIR/.env is here: this is an upgrade. Its settings are kept and nothing is asked."
    return
  fi
  if [ "$DRY" = 1 ]; then
    say "  would ask for the host name if it is not given"
  else
    [ -n "$HOST" ] || ask HOST "Host name of this server (such as ontology.example.edu)"
    HOST=${HOST,,}
    valid_host "$HOST" ||
      refuse "--host is a full host name that points to this server, such as ontology.example.edu."
  fi
  check_platform
  if [ "$DRY" = 1 ]; then
    HOST=${HOST:-<host name>}
    CODE="<code>"
    say "Writing $DIR/.env (readable by root alone)."
    say "  would write: the host name, the console's and the platform's addresses, the link's code, the engine's settings and four generated secrets"
    return
  fi
  CODE=$(secret 16)

  say "Writing $DIR/.env (readable by root alone)."
  mkdir -p "$DIR"
  # CONNECTION_STRINGS is left out on purpose: while it is set the engine ignores what the console connects.
  (
    umask 077
    cat >"$DIR/.env" <<EOF
# The ibl.ai ontology server: settings of this server, read by the compose files beside it.
# Keep a copy somewhere safe. An upgrade keeps it; only an empty AO_API_KEY is filled in.
ONTOLOGY_HOST=$HOST
ONTOLOGY_FRONTEND=$FRONTEND
ONTOLOGY_DM_URL=$PLATFORM_URL
ONTOLOGY_SETUP_CODE=$CODE
AO_API_KEY=
# NVIDIA's auto-ontology engine. It applies the admin password again at every start.
POSTGRES_USER=postgres
POSTGRES_PASSWORD=$(secret 24)
POSTGRES_DATABASE=auto_ontology
POSTGRES_PORT=5434
PGADMIN_EMAIL=admin@$HOST
PGADMIN_PASSWORD=$(secret 16)
AUTH_SECRET=$(secret 32)
APP_URL=https://$HOST
AUTO_ONTOLOGY_ADMIN_EMAIL=admin@$HOST
AUTO_ONTOLOGY_ADMIN_PASSWORD=$(secret 24)
# No model yet: the engine names terms from table and column names, infers no joins and answers no questions.
DEFAULT_MODELS_API_KEY=nvapi-not-set
EOF
  )
}

fetch() {
  local attempt
  say "Getting the compose files of version $VERSION."
  run curl -fsSL -o "$DIR/server.yml" "$REPO/releases/download/v$VERSION/server.yml"
  run curl -fsSL -o "$DIR/auto-ontology.override.yml" "$REPO/releases/download/v$VERSION/auto-ontology.override.yml"

  if [ -f "$DIR/engine/.sha" ] && [ "$(<"$DIR/engine/.sha")" = "$ENGINE_SHA" ]; then
    say "NVIDIA's engine source at ${ENGINE_SHA:0:8} is already here."
  elif [ "$DRY" = 1 ]; then
    say "  would download NVIDIA's engine source at ${ENGINE_SHA:0:8} into $DIR/engine"
  else
    say "Getting NVIDIA's engine source at ${ENGINE_SHA:0:8}."
    # Unpacked beside the old copy, which is replaced only once the new one is whole.
    rm -rf "$DIR/engine.new"
    mkdir -p "$DIR/engine.new"
    if ! curl -fsSL "https://codeload.github.com/NVIDIA/auto-ontology/tar.gz/$ENGINE_SHA" |
      tar -xz -C "$DIR/engine.new" --strip-components=1; then
      stop "NVIDIA's engine source could not be downloaded from codeload.github.com. $DIR is left as it is; run this again."
    fi
    printf '%s\n' "$ENGINE_SHA" >"$DIR/engine.new/.sha"
    rm -rf "$DIR/engine"
    mv "$DIR/engine.new" "$DIR/engine"
  fi

  # The engine's base image comes from nvcr.io, whose pulls have timed out before.
  for attempt in 1 2 3; do
    say "Building the engine (attempt $attempt of 3; the first build takes several minutes)."
    if run "${COMPOSE[@]}" build; then
      break
    fi
    [ "$attempt" -lt 3 ] ||
      stop "the engine did not build in three attempts: Docker's output is above. $DIR is left as it is; run this again once the cause is gone."
    sleep 20
  done
  say "Getting the images that are not built here."
  run "${COMPOSE[@]}" pull --quiet ontology proxy postgres
}

# Runs inside the engine's web container: the admin's sign-in is in its environment, never on a command line.
IFS= read -r -d '' MINT <<'JS' || true
const AO = "http://127.0.0.1:3100";
const origin = process.env.APP_URL;
const fail = (step, status) => {
  console.error(`${step} failed${status ? ` (HTTP ${status})` : ""}.`);
  process.exit(1);
};
(async () => {
  const email = process.env.AUTO_ONTOLOGY_ADMIN_EMAIL;
  const password = process.env.AUTO_ONTOLOGY_ADMIN_PASSWORD;
  if (!origin || !email || !password) fail("Reading the engine admin's sign-in from the container");
  const json = { "content-type": "application/json", origin };
  const signIn = await fetch(`${AO}/api/auth/sign-in/email`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ email, password }),
  });
  if (!signIn.ok) fail("Signing in as the engine's admin", signIn.status);
  const cookie = signIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const session = { ...json, cookie };
  const minted = await fetch(`${AO}/api/api-tokens`, {
    method: "POST",
    headers: session,
    body: JSON.stringify({ name: "ontology-server" }),
  });
  if (!minted.ok) fail("Making the key", minted.status);
  const token = (await minted.json().catch(() => ({}))).token;
  if (typeof token !== "string" || !token) fail("Reading the key from the engine's answer", minted.status);
  const check = await fetch(`${AO}/api/connections`, { headers: { "x-api-key": token } });
  if (!check.ok) fail("Checking the key", check.status);
  // The key is made and checked; a sign-out that fails leaves a session that expires by itself.
  await fetch(`${AO}/api/auth/sign-out`, { method: "POST", headers: session, body: "{}" }).catch(() => {});
  process.stdout.write(token);
})().catch((error) => {
  console.error(`The engine's web app could not be reached (${error.cause?.code ?? error.name}).`);
  process.exit(1);
});
JS

# Rewritten whole under root's umask, never through a command's arguments: the key is a secret.
store_key() { # store_key <key>
  (
    umask 077
    {
      grep -v '^AO_API_KEY=' "$DIR/.env"
      printf 'AO_API_KEY=%s\n' "$1"
    } >"$DIR/.env.new"
    mv "$DIR/.env.new" "$DIR/.env"
  )
}

engine_ready() {
  local deadline health="" id
  if [ "$DRY" = 1 ]; then
    say "  would wait up to 5 minutes for NVIDIA's web app to be healthy"
    return
  fi
  say "Waiting for NVIDIA's web app (up to 5 minutes)."
  deadline=$((SECONDS + 300))
  until [ "$health" = healthy ]; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      "${COMPOSE[@]}" logs --tail 25 auto-ontology ingestion-service auto-ontology-frontend || true
      stop "NVIDIA's web app was not ready in 5 minutes: the engine's last lines are above. $DIR is left as it is; run this again once the cause is gone."
    fi
    sleep 5
    id=$("${COMPOSE[@]}" ps -q auto-ontology-frontend 2>/dev/null || true)
    health=$(docker inspect --format '{{.State.Health.Status}}' "$id" 2>/dev/null || true)
  done
}

mint_key() {
  local key
  if [ -n "$(kept AO_API_KEY)" ]; then
    say "This server's key to the engine is in $DIR/.env: kept."
    return
  fi
  if [ "$DRY" = 1 ]; then
    say "  would sign in to the engine as its admin, inside its web container, and write the key it makes into $DIR/.env"
    return
  fi
  say "Making this server's key to the engine, signed in as the engine's admin inside its own container."
  if ! key=$("${COMPOSE[@]}" exec -T auto-ontology-frontend node -e "$MINT"); then
    stop "the engine did not give a key: the step that failed is above. $DIR is left as it is; run this again."
  fi
  [[ "$key" =~ $KEY_RE ]] ||
    stop "the engine answered with something that is not one of its keys. $DIR is left as it is; run this again."
  store_key "$key"
  say "The key is written into $DIR/.env."
}

start() {
  local deadline status=""
  say "Starting NVIDIA's engine."
  if ! run "${COMPOSE[@]}" up --detach postgres auto-ontology ingestion-service auto-ontology-frontend; then
    "${COMPOSE[@]}" logs --tail 25 auto-ontology-migrate frontend-migrate auto-ontology auto-ontology-frontend || true
    stop "the engine did not start: its last lines are above. $DIR is left as it is; run this again once the cause is gone."
  fi
  engine_ready
  mint_key

  say "Starting the server and its proxy."
  if ! run "${COMPOSE[@]}" up --detach --remove-orphans; then
    "${COMPOSE[@]}" logs --tail 25 ontology proxy || true
    stop "the server did not start: its last lines are above. $DIR is left as it is; run this again once the cause is gone."
  fi
  if [ "$DRY" = 1 ]; then
    say "  would wait up to 3 minutes for https://$HOST/iblai/api/host/setup to answer 200"
    return
  fi
  say "Waiting for https://$HOST/iblai/api/host/setup: the certificate comes first (up to 3 minutes)."
  deadline=$((SECONDS + 180))
  until [ "$status" = 200 ]; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      "${COMPOSE[@]}" logs --tail 25 proxy ontology || true
      stop "https://$HOST/iblai/api/host/setup did not answer in 3 minutes: the last lines of the proxy and the server are above. Check that $HOST points to this server and that ports 80 and 443 are open to the internet, then run this again."
    fi
    sleep 5
    # Asked on this machine's own address: not every network lets a server reach its public one.
    status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 --resolve "$HOST:443:127.0.0.1" "https://$HOST/iblai/api/host/setup" || true)
  done
}

finish() {
  local state=""
  if [ "$DRY" != 1 ]; then
    # Anyone may ask a server whether it is set up.
    state=$(curl -s --max-time 10 --resolve "$HOST:443:127.0.0.1" "https://$HOST/iblai/api/host/setup" || true)
  fi
  say ""
  say "The ontology server is running (version $VERSION)."
  say ""
  if [[ "${state// /}" == *'"set_up":true'* ]]; then
    say "  This server is set up: manage it in the console, at $FRONTEND"
  elif [ -n "$CODE" ]; then
    say "  Open this to finish (works once):"
    say "  $FRONTEND/#host=$HOST&code=$CODE"
    say ""
    say "  It asks you to sign in to ibl.ai; the server becomes the ontology server of the platform"
    say "  you are signed in to. Lost it? Run the install command again."
  fi
  cat <<EOF

  The address agents call:   https://$HOST/iblai/<platform>/<server>/mcp
  NVIDIA's own console:      https://$HOST/
    Sign in as admin@$HOST; its password is AUTO_ONTOLOGY_ADMIN_PASSWORD in $DIR/.env.
  No model is configured yet: the engine names terms from table and column names, infers
  no joins and answers no questions.

  Its files:   $DIR/.env
               $DIR/server.yml
               $DIR/auto-ontology.override.yml
               $DIR/engine/   (NVIDIA's source at ${ENGINE_SHA:0:8})
  Keep a copy of .env somewhere safe: it holds the engine's passwords and this server's key to it.
  The data lives in Docker volumes: iblai-ontology_postgres_data (the engine's database),
  iblai-ontology_ontology_data (this server's files) and iblai-ontology_certificates.

  Logs:      ${COMPOSE[*]} logs --follow
  Upgrade:   curl -fsSL $REPO/releases/latest/download/install.sh | sudo bash
  Remove:    curl -fsSL $REPO/releases/latest/download/install.sh | sudo bash -s -- --uninstall
EOF
}

uninstall() {
  local host confirm typed=""
  refuse_older
  if [ ! -f "$DIR/.env" ]; then
    refuse "no ontology server is installed in $DIR."
  fi
  host=$(kept ONTOLOGY_HOST)
  confirm=${host:-remove}
  say "This removes the ontology server${host:+ at $host}: its containers and images, NVIDIA's engine"
  say "with its database (the systems it reads, its terms and what was certified, its users and"
  say "keys), the server's own files (the platform it belongs to, the MCP servers deployed on it),"
  say "the certificate, and $DIR with .env."
  say "Remove each agent's connection in the console first, so its key is deleted."
  if [ "$DRY" = 1 ]; then
    say "  would ask for \"$confirm\" to be typed"
  else
    ask typed "Type $confirm to go on"
    [ "$typed" = "$confirm" ] || stop "that is not $confirm. Nothing was removed."
  fi
  # An install stopped before its files arrived started nothing from them.
  if [ -f "$DIR/engine/docker-compose.yml" ] && [ -f "$DIR/auto-ontology.override.yml" ] && [ -f "$DIR/server.yml" ]; then
    run "${COMPOSE[@]}" down --volumes --rmi all --remove-orphans
  else
    say "$DIR holds no complete install: no container was started from it."
  fi
  run rm -rf "$DIR"
  cat <<EOF

Removed. Still in place:
  - Docker. If this script installed it: apt-get remove --purge docker.io docker-compose-v2 docker-buildx
  - What the ibl.ai platform keeps: the key and the MCP server of each agent that was still
    connected. Delete them in the platform.
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
    refuse "--frontend is the console's address, such as https://ontology.ibl.ai."
  PLATFORM_URL=${PLATFORM_URL%/}
  [[ "$PLATFORM_URL" =~ $URL_RE ]] ||
    refuse "--platform-url is an https address, such as https://api.iblai.app/dm."
  HOST=${HOST,,}
  if [ -n "$HOST" ] && ! valid_host "$HOST"; then
    refuse "--host is a full host name that points to this server, such as ontology.example.edu."
  fi
  check_server
  ensure_docker
  settings
  fetch
  start
  finish
}

# Last line on purpose: a download cut short runs nothing.
main "$@"
