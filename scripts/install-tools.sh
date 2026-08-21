#!/bin/sh
set -eu

fail() {
  echo "$*" >&2
  exit 1
}

as_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@"
  elif command -v sudo >/dev/null 2>&1; then sudo "$@"
  else fail "Root access is required to install: $*"
  fi
}

detect_manager() {
  case "$os" in
    Darwin) command -v brew >/dev/null 2>&1 || fail 'Homebrew is required: https://brew.sh'; echo brew ;;
    Linux)
      for candidate in apt-get dnf pacman apk zypper brew; do
        command -v "$candidate" >/dev/null 2>&1 && { echo "$candidate"; return; }
      done
      fail 'Unsupported Linux distribution: install Go, Node.js/npm, and just manually'
      ;;
    *) fail "Unsupported operating system: $os" ;;
  esac
}

install() {
  tool=$1
  shift
  command -v "$tool" >/dev/null 2>&1 && return
  case "$manager" in
    brew) brew install "$@" ;;
    apt-get) as_root apt-get install -y "$@" ;;
    dnf) as_root dnf install -y "$@" ;;
    pacman) as_root pacman -S --needed --noconfirm "$@" ;;
    apk) as_root apk add "$@" ;;
    zypper) as_root zypper --non-interactive install "$@" ;;
  esac
}

os=$(uname -s)
case "$os" in Darwin|Linux) ;; *) fail "Unsupported operating system: $os" ;; esac

if ! command -v go >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1 || ! command -v just >/dev/null 2>&1; then
  manager=$(detect_manager)
  if [ "$manager" = apt-get ]; then as_root apt-get update; fi
  case "$manager" in
    brew) install go go; install npm node; install just just ;;
    apt-get) install go golang-go; install npm nodejs npm; install just just ;;
    dnf) install go golang; install npm nodejs npm; install just just ;;
    pacman) install go go; install npm nodejs npm; install just just ;;
    apk) install go go; install npm nodejs npm; install just just ;;
    zypper) install go go; install npm nodejs npm; install just just ;;
  esac
fi

go version
npm --version
just --version
