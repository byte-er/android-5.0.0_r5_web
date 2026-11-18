#!/usr/bin/env python3
"""Verify this tree against upstream AOSP android-5.0.0_r5 and restore damage.

The tree was uploaded through the web, which dropped files matching
.gitignore patterns (generated sources AOSP commits on purpose), dropped
files too large for GitHub, turned symlinks/hardlinks into empty files and
lost exec bits.  This script compares every project in the release manifest
with the upstream tree -- path, blob id and mode -- using a GitHub mirror of
AOSP, and restores whatever differs.

Only tree metadata is downloaded for the comparison (partial clone,
--filter=blob:none); file contents are fetched only for files that need
restoring.

usage (from the top of the tree):
    tools/aosp-restore.py --check            # report only
    tools/aosp-restore.py                    # report and restore
    tools/aosp-restore.py --projects external/libnl,bionic
Options:
    --mirror URL     extra mirror base tried first (the defaults are
                     aosp-mirror-neo, aosp-mirror and msft-mirror-aosp on GitHub)
    --skip-absent P  comma-separated path prefixes: projects under these that
                     are entirely absent locally are not restored (default tools/)
    --tag TAG        release tag (default android-5.0.0_r5)
    --jobs N         parallel projects (default 8)
    --cache DIR      where partial clones are kept
    --skip-darwin    ignore darwin-only prebuilts (default on)
    --exclude FILE   paths never restored, one per line (default
                     tools/aosp-restore-exclude.txt: files over GitHub's
                     100 MB limit)
"""
import argparse
import concurrent.futures
import os
import subprocess
import sys
import xml.etree.ElementTree as ET

TOP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run(cmd, cwd=None, check=True, input=None):
    r = subprocess.run(cmd, cwd=cwd, input=input, capture_output=True)
    if check and r.returncode != 0:
        raise RuntimeError("%s failed: %s" % (" ".join(cmd), r.stderr.decode(errors="replace")[-500:]))
    return r


def load_manifest(args):
    cache = args.cache
    mdir = os.path.join(cache, "manifest.git")
    if not os.path.isdir(mdir):
        run(["git", "init", "-q", "--bare", mdir])
    run(["git", "fetch", "-q", "--depth", "1",
         "https://github.com/aosp-mirror/platform_manifest",
         "refs/tags/%s:refs/tags/%s" % (args.tag, args.tag)], cwd=mdir)
    xml = run(["git", "show", "%s:default.xml" % args.tag], cwd=mdir).stdout
    root = ET.fromstring(xml)
    projects = []
    for p in root.iter("project"):
        path = p.get("path") or p.get("name")
        groups = p.get("groups", "")
        if args.skip_darwin and ("darwin" in groups.split(",") or "/darwin-x86" in path):
            continue
        projects.append((path, p.get("name")))
    return projects


def local_index():
    out = run(["git", "ls-files", "-s", "-z"], cwd=TOP).stdout
    idx = {}
    for rec in out.split(b"\0"):
        if not rec:
            continue
        meta, path = rec.split(b"\t", 1)
        mode, sha, _stage = meta.split()
        idx[path.decode()] = (mode.decode(), sha.decode())
    return idx


MIRRORS = [
    ("https://github.com/aosp-mirror-neo", "_"),
    ("https://github.com/aosp-mirror", "_"),
    ("https://github.com/msft-mirror-aosp", "."),
]


def project_repo(args, name):
    d = os.path.join(args.cache, name.replace("/", "_") + ".git")
    ref = "refs/tags/%s" % args.tag
    if not os.path.isdir(d):
        run(["git", "init", "-q", "--bare", d])
    have = run(["git", "rev-parse", "-q", "--verify", ref], cwd=d, check=False)
    if have.returncode == 0:
        return d, ref
    mirrors = list(MIRRORS)
    if args.mirror:
        mirrors.insert(0, (args.mirror, "_"))
    errors = []
    for base, sep in mirrors:
        url = "%s/%s" % (base, name.replace("/", sep))
        run(["git", "remote", "remove", "origin"], cwd=d, check=False)
        run(["git", "remote", "add", "origin", url], cwd=d)
        run(["git", "config", "remote.origin.promisor", "true"], cwd=d)
        run(["git", "config", "remote.origin.partialclonefilter", "blob:none"], cwd=d)
        r = run(["git", "fetch", "-q", "--depth", "1", "--filter=blob:none",
                 "origin", "%s:%s" % (ref, ref)], cwd=d, check=False)
        if r.returncode == 0:
            return d, ref
        errors.append(base)
    raise RuntimeError("not found on any mirror (%s)" % ", ".join(errors))


def compare(args, idx, path, name):
    d, ref = project_repo(args, name)
    out = run(["git", "ls-tree", "-r", "-z", "--full-tree", ref], cwd=d).stdout
    diffs = []
    for rec in out.split(b"\0"):
        if not rec:
            continue
        meta, rel = rec.split(b"\t", 1)
        mode, typ, sha = meta.decode().split()
        if typ != "blob":
            continue
        full = path + "/" + rel.decode()
        if full in args.excluded:
            continue
        cur = idx.get(full)
        if cur is None:
            diffs.append(("missing", full, mode, sha))
        elif cur[1] != sha:
            diffs.append(("content", full, mode, sha))
        elif cur[0] != mode:
            diffs.append(("mode", full, mode, sha))
    return d, diffs


def restore(repo, diffs):
    need = [sha for kind, _, _, sha in diffs if kind != "mode"]
    blobs = {}
    if need:
        # One batched request: fetch exactly the blobs we need.
        inp = ("\n".join(sorted(set(need))) + "\n").encode()
        run(["git", "-c", "fetch.negotiationAlgorithm=noop", "fetch", "-q",
             "--no-tags", "--filter=blob:none", "--stdin", "origin"],
            cwd=repo, check=False, input=inp)
        for sha in set(need):
            blobs[sha] = run(["git", "cat-file", "blob", sha], cwd=repo).stdout
    done = []
    for kind, full, mode, sha in diffs:
        dest = os.path.join(TOP, full)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if os.path.lexists(dest) and (kind != "mode" or mode == "120000"
                                      or os.path.islink(dest)):
            os.remove(dest)
        if mode == "120000":
            data = blobs.get(sha)
            if data is None:
                data = run(["git", "cat-file", "blob", sha], cwd=repo).stdout
            os.symlink(data.decode(), dest)
        else:
            if kind != "mode":
                with open(dest, "wb") as f:
                    f.write(blobs[sha])
            os.chmod(dest, 0o755 if mode == "100755" else 0o644)
        done.append(full)
    return done


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--mirror", default="")
    ap.add_argument("--skip-absent", default="tools/")
    ap.add_argument("--tag", default="android-5.0.0_r5")
    ap.add_argument("--jobs", type=int, default=8)
    ap.add_argument("--cache", default=os.path.join(TOP, ".aosp-restore-cache"))
    ap.add_argument("--projects", default="")
    ap.add_argument("--skip-darwin", action="store_true", default=True)
    ap.add_argument("--exclude", default=os.path.join(TOP, "tools", "aosp-restore-exclude.txt"))
    args = ap.parse_args()
    os.makedirs(args.cache, exist_ok=True)
    args.excluded = set()
    if os.path.exists(args.exclude):
        args.excluded = set(l.strip() for l in open(args.exclude)
                            if l.strip() and not l.startswith("#"))

    projects = load_manifest(args)
    if args.projects:
        want = set(args.projects.split(","))
        projects = [p for p in projects if p[0] in want]
    idx = local_index()
    skip = tuple(x for x in args.skip_absent.split(",") if x)
    if skip:
        projects = [p for p in projects
                    if not (p[0].startswith(skip) and not os.path.isdir(os.path.join(TOP, p[0])))]

    summary = {}
    restored = []
    failures = []

    def work(p):
        path, name = p
        try:
            repo, diffs = compare(args, idx, path, name)
        except Exception as e:  # mirror missing, network ...
            return path, None, str(e)
        return path, (repo, diffs), None

    with concurrent.futures.ThreadPoolExecutor(args.jobs) as ex:
        for path, res, err in ex.map(work, projects):
            if err:
                failures.append((path, err))
                print("ERROR  %-60s %s" % (path, err.splitlines()[0][:120]), flush=True)
                continue
            repo, diffs = res
            if not diffs:
                continue
            kinds = {}
            for k, *_ in diffs:
                kinds[k] = kinds.get(k, 0) + 1
            summary[path] = kinds
            print("DIFF   %-60s %s" % (path, kinds), flush=True)
            for k, full, mode, _ in diffs[:5]:
                print("         %-8s %s %s" % (k, mode, full))
            if not args.check:
                try:
                    restored += restore(repo, diffs)
                except Exception as e:
                    failures.append((path, str(e)))
                    print("FAILED restore %s: %s" % (path, e), flush=True)

    total = {}
    for kinds in summary.values():
        for k, n in kinds.items():
            total[k] = total.get(k, 0) + n
    print("\n%d projects checked, %d differ: %s" % (len(projects), len(summary), total))
    print("%d errors" % len(failures))
    if restored:
        lst = os.path.join(args.cache, "restored.txt")
        with open(lst, "w") as f:
            f.write("\n".join(restored) + "\n")
        print("%d files restored (list in %s)" % (len(restored), lst))
        print("add them with:  git add -f --pathspec-from-file=%s" % lst)


if __name__ == "__main__":
    main()
