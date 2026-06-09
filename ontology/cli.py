"""``ontology`` command-line interface.

    ontology validate                 # check the registry config
    ontology list                     # list filesystems and permissions
    ontology plan      --sandbox ID    # show what would mount, no changes
    ontology mount     --sandbox ID    # mount every permitted filesystem
    ontology unmount   --sandbox ID    # unmount them
    ontology status    --sandbox ID    # show current mount state
    ontology manifest  --sandbox ID    # emit the JSON the agent reads
    ontology systemd   --sandbox ID    # render systemd .mount units
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from .config import ConfigError
from .registry import RegistryService

DEFAULT_CONFIG = os.environ.get("ONTOLOGY_CONFIG", "/etc/ontology/ontology.yaml")


def _service(args: argparse.Namespace) -> RegistryService:
    try:
        return RegistryService.from_file(args.config)
    except ConfigError as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(2)


def cmd_validate(args: argparse.Namespace) -> int:
    svc = _service(args)
    print(f"ok: {args.config} is valid "
          f"({len(svc.registry.filesystems)} filesystems, "
          f"{len(svc.registry.permissions)} permissions, "
          f"{len(svc.registry.sandboxes)} sandboxes)")
    return 0


def cmd_list(args: argparse.Namespace) -> int:
    svc = _service(args)
    print("FILESYSTEMS")
    for fs in svc.registry.filesystems:
        target = (f"{fs.file_system_id} ({fs.region})" if fs.type.value == "efs"
                  else f"{fs.server}:{fs.export}")
        print(f"  {fs.id:<20} {fs.type.value:<4} {target}  root={fs.root}")
    print("\nPERMISSIONS")
    for p in svc.registry.permissions:
        who = ",".join(p.sandboxes)
        print(f"  {p.filesystem:<20} -> {p.mount_path:<24} {p.access.value:<2}  sandboxes={who}")
    return 0


def _print_results(results) -> int:
    rc = 0
    for r in results:
        mark = {"mounted": "+", "exists": "=", "dry-run": "~", "error": "!"}.get(r.status, "?")
        detail = f"  ({r.detail})" if r.detail else ""
        print(f"[{mark}] {r.mount.mount_path:<24} {r.status}{detail}")
        if args_verbose:
            print("      " + " ".join(r.command))
        if r.status == "error":
            rc = 1
    return rc


def cmd_plan(args: argparse.Namespace) -> int:
    svc = _service(args)
    results = svc.mount_all(args.sandbox, dry_run=True, force_nfs=args.nfs)
    if not results:
        print(f"no filesystems are granted to sandbox {args.sandbox!r}")
        return 0
    return _print_results(results)


def cmd_mount(args: argparse.Namespace) -> int:
    svc = _service(args)
    return _print_results(svc.mount_all(args.sandbox, dry_run=args.dry_run, force_nfs=args.nfs))


def cmd_unmount(args: argparse.Namespace) -> int:
    svc = _service(args)
    return _print_results(svc.unmount_all(args.sandbox, dry_run=args.dry_run))


def cmd_status(args: argparse.Namespace) -> int:
    from . import mounter
    svc = _service(args)
    for m in svc.mounts_for(args.sandbox):
        state = "mounted" if mounter.is_mounted(m.mount_path) else "absent"
        print(f"[{'+' if state == 'mounted' else '-'}] {m.mount_path:<24} "
              f"{m.filesystem.id:<20} {m.access.value:<2} {state}")
    return 0


def cmd_manifest(args: argparse.Namespace) -> int:
    svc = _service(args)
    print(json.dumps(svc.manifest_for(args.sandbox), indent=2))
    return 0


def cmd_systemd(args: argparse.Namespace) -> int:
    svc = _service(args)
    units = svc.systemd_units(args.sandbox)
    if args.out:
        os.makedirs(args.out, exist_ok=True)
        for name, body in units.items():
            path = os.path.join(args.out, name)
            with open(path, "w") as fh:
                fh.write(body)
            print(f"wrote {path}")
    else:
        for name, body in units.items():
            print(f"# ==== {name} ====\n{body}")
    return 0


args_verbose = False


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="ontology", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("-c", "--config", default=DEFAULT_CONFIG,
                   help=f"registry config path (default: {DEFAULT_CONFIG})")
    p.add_argument("-v", "--verbose", action="store_true", help="print mount commands")
    sub = p.add_subparsers(dest="command", required=True)

    sub.add_parser("validate", help="validate the registry config").set_defaults(func=cmd_validate)
    sub.add_parser("list", help="list filesystems and permissions").set_defaults(func=cmd_list)

    def add_sandbox(sp, dry=False, nfs=False):
        sp.add_argument("-s", "--sandbox", required=True, help="sandbox id")
        if dry:
            sp.add_argument("--dry-run", action="store_true", help="show without changing")
        if nfs:
            sp.add_argument("--nfs", action="store_true",
                            help="force generic NFS mount even for EFS")

    sp = sub.add_parser("plan", help="show what would mount"); add_sandbox(sp, nfs=True)
    sp.set_defaults(func=cmd_plan)
    sp = sub.add_parser("mount", help="mount permitted filesystems"); add_sandbox(sp, dry=True, nfs=True)
    sp.set_defaults(func=cmd_mount)
    sp = sub.add_parser("unmount", help="unmount filesystems"); add_sandbox(sp, dry=True)
    sp.set_defaults(func=cmd_unmount)
    sp = sub.add_parser("status", help="show mount state"); add_sandbox(sp)
    sp.set_defaults(func=cmd_status)
    sp = sub.add_parser("manifest", help="emit the agent-facing JSON manifest"); add_sandbox(sp)
    sp.set_defaults(func=cmd_manifest)
    sp = sub.add_parser("systemd", help="render systemd .mount units"); add_sandbox(sp)
    sp.add_argument("-o", "--out", help="directory to write units into")
    sp.set_defaults(func=cmd_systemd)
    return p


def main(argv: list[str] | None = None) -> int:
    global args_verbose
    parser = build_parser()
    args = parser.parse_args(argv)
    args_verbose = args.verbose
    return args.func(args)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
