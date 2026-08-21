#!/bin/sh
set -eu

install() {
  command -v "$1" >/dev/null 2>&1 && return
  if ! command -v brew >/dev/null 2>&1; then
    echo "$1 is missing; install Homebrew from https://brew.sh or install it manually" >&2
    exit 1
  fi
  brew install "$2"
}

install go go
install npm node
# just is written in Rust and cannot be installed with go install.
install just just

go version
npm --version
just --version
