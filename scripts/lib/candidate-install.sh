#!/bin/bash
# Transactional candidate promotion shared by direct installs and rebuild flows.
# shellcheck shell=bash

candidate_backup_path() {
    local final_dir="$1"
    local base="${final_dir}.backup-$(date +%Y%m%d%H%M%S)"
    local candidate="$base"
    local suffix=1
    while [ -e "$candidate" ]; do
        candidate="$base-$suffix"
        suffix=$((suffix + 1))
    done
    printf '%s\n' "$candidate"
}

assert_distinct_candidate_paths() {
    local candidate_dir="$1"
    local final_dir="$2"
    [ "$(realpath -m "$candidate_dir")" != "$(realpath -m "$final_dir")" ] || \
        error "Candidate and final app paths must differ: $final_dir"
    [ "$(dirname "$(realpath -m "$candidate_dir")")" = "$(dirname "$(realpath -m "$final_dir")")" ] || \
        error "Candidate must be a sibling of the final app so promotion stays on one filesystem"
}

promote_candidate_install() {
    local candidate_dir="$1"
    local final_dir="$2"
    local backup=""
    local previous_install_dir="${INSTALL_DIR:-}"

    [ -d "$candidate_dir" ] || error "Candidate app was not created: $candidate_dir"
    assert_distinct_candidate_paths "$candidate_dir" "$final_dir"

    # The long build is allowed while the app runs. Only the short atomic
    # promotion window requires the installed executable to be stopped.
    INSTALL_DIR="$final_dir"
    assert_install_target_not_running
    INSTALL_DIR="$previous_install_dir"

    if [ -e "$final_dir" ]; then
        backup="$(candidate_backup_path "$final_dir")"
        info "Moving existing app to backup: $backup"
        mv "$final_dir" "$backup"
    fi

    info "Promoting accepted candidate: $final_dir"
    if ! mv "$candidate_dir" "$final_dir"; then
        warn "Candidate promotion failed; restoring the previous app"
        if [ -n "$backup" ] && [ -e "$backup" ] && [ ! -e "$final_dir" ]; then
            mv "$backup" "$final_dir" || error "Could not restore backup after failed promotion: $backup"
        fi
        return 1
    fi

    PROMOTED_BACKUP_APP_DIR="$backup"
    export PROMOTED_BACKUP_APP_DIR
}
