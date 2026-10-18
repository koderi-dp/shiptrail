"""Validated repo configuration, pure v1 upgrades, and machine settings (§5)."""

import copy
import json
import sqlite3
import warnings
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import (BaseModel, ConfigDict, Discriminator, Field, PrivateAttr, StringConstraints,
                      Tag, ValidationError, ValidationInfo, field_validator, model_validator)

from shiptrail import __version__
from shiptrail.engine import db, versioning
from shiptrail.engine.roles import Provider, Role, RoleError, resolve_role

Identifier = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]{0,31}$")]
RoleName = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9-]{0,63}$")]
Nonempty = Annotated[str, StringConstraints(min_length=1, pattern=r"\S")]
PositiveMinutes = Annotated[float, Field(gt=0, allow_inf_nan=False)]
TEMPLATE = Path(__file__).resolve().parent.parent / "templates" / "config.json"


class ConfigModel(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", populate_by_name=True)


class ConfigFieldErrors(ValueError):
    """Semantic config problems, each located by a field path relative to where it was raised."""

    def __init__(self, issues: list[tuple[tuple[str | int, ...], str]]):
        self.issues = issues
        super().__init__("; ".join(message for _, message in issues))


class Profile(ConfigModel):
    model: Nonempty
    effort: Nonempty


class Execution(ConfigModel):
    id: Identifier
    uses: RoleName
    provider: Provider
    profiles: dict[Provider, Profile]
    timeoutMinutes: PositiveMinutes | None = None
    maxBudgetUsd: Annotated[float, Field(gt=0, allow_inf_nan=False)] | None = None

    @model_validator(mode="after")
    def selected_profile(self) -> "Execution":
        if self.provider not in self.profiles:
            raise ConfigFieldErrors([(("profiles", self.provider),
                                      f"profiles[{self.provider}] needs explicit model and effort")
                                     ])
        if self.provider == "codex" and self.maxBudgetUsd is not None:
            warnings.warn(f"{self.id}: maxBudgetUsd is ignored for Codex",
                          UserWarning,
                          stacklevel=2)
        if self.provider == "opencode":
            if self.maxBudgetUsd is not None:
                warnings.warn(f"{self.id}: maxBudgetUsd is ignored for OpenCode",
                              UserWarning,
                              stacklevel=2)
            # `opencode run --model` needs the CLI's provider/model[#variant] form.
            if "/" not in self.profiles["opencode"].model:
                raise ConfigFieldErrors([(("profiles", "opencode", "model"),
                                          f"{self.id}: profiles[opencode].model must be "
                                          "provider/model for OpenCode")])
        return self


class SingleStep(Execution):
    label: Annotated[str, StringConstraints(min_length=1, max_length=80)] | None = None
    onChanges: Identifier | None = None

    @property
    def executions(self) -> list[Execution]:
        return [self]


class ParallelStep(ConfigModel):
    id: Identifier
    parallel: Annotated[list[Execution], Field(min_length=1, max_length=16)]
    label: Annotated[str, StringConstraints(min_length=1, max_length=80)] | None = None
    onChanges: Identifier | None = None

    @property
    def executions(self) -> list[Execution]:
        return self.parallel


STEP_TAGS = ("single-step", "parallel-step")


def _step_tag(value: Any) -> str:
    if isinstance(value, dict):
        return "parallel-step" if "parallel" in value else "single-step"
    return "parallel-step" if isinstance(value, ParallelStep) else "single-step"


Step = Annotated[Annotated[SingleStep, Tag("single-step")]
                 | Annotated[ParallelStep, Tag("parallel-step")],
                 Discriminator(_step_tag)]


class RepoConcurrency(ConfigModel):
    perJob: Annotated[int, Field(ge=1, le=16)] = 4


class Timeouts(ConfigModel):
    executionMinutes: PositiveMinutes = 60


class RepoConfig(ConfigModel):
    version: Literal[2] = 2
    engine: Nonempty
    # Jobs branch from, and merge into, this branch. `shiptrail init` sets it to the repo's
    # current branch; older configs without the key keep using main.
    baseBranch: Nonempty = "main"
    defaultPipeline: Identifier
    pipelines: dict[Identifier, Annotated[list[Step], Field(min_length=1, max_length=32)]]
    maxRounds: Annotated[int, Field(ge=1, le=5)] = 3
    merge: Literal["auto", "verify"] = "verify"
    permissions: Literal["auto", "bypass"] = "auto"
    concurrency: RepoConcurrency = Field(default_factory=RepoConcurrency)
    timeouts: Timeouts = Field(default_factory=Timeouts)
    sensitivePaths: list[Nonempty] = Field(default_factory=lambda: [
        "**/migrations/**",
        ".github/**",
        "**/*.lock",
        "package.json",
        "pyproject.toml",
        "**/auth/**",
        "Dockerfile",
        "**/*.tf",
    ])
    _roles: dict[tuple[str, str], Role] = PrivateAttr(default_factory=dict)

    @model_validator(mode="after")
    def validate_pipelines(self, info: ValidationInfo) -> "RepoConfig":
        issues: list[tuple[tuple[str | int, ...], str]] = []
        if self.defaultPipeline not in self.pipelines:
            issues.append((("defaultPipeline", ), "defaultPipeline must name an existing pipeline"))
        root = Path((info.context or {}).get("root", Path.cwd()))
        resolved = {}
        for name, steps in self.pipelines.items():
            ids: set[str] = set()
            tasks: set[str] = set()
            kinds: dict[int, str] = {}
            unresolved = False
            # Steps whose role did not resolve have no known type to check onChanges against.
            untyped: set[str] = set()
            approvals: list[int] = []
            for i, step in enumerate(steps):
                where: tuple[str | int, ...] = ("pipelines", name, i)
                # A single step is its own execution; count that id only once.
                entries = [(step.id, where + ("id", ))]
                if isinstance(step, ParallelStep):
                    entries += [(e.id, where + ("parallel", j, "id"))
                                for j, e in enumerate(step.parallel)]
                for identifier, loc in entries:
                    if identifier in ids:
                        issues.append(
                            (loc, f"{name}: duplicate step or execution id: {identifier}"))
                    ids.add(identifier)
                roles = []
                step_ok = True
                for j, execution in enumerate(step.executions):
                    try:
                        role = resolve_role(execution.uses, execution.provider, root=root)
                    except RoleError as exc:
                        base = where + (("parallel", j) if isinstance(step, ParallelStep) else ())
                        issues.append((base + ("uses", ), str(exc)))
                        step_ok = False
                        continue
                    resolved[name, execution.id] = role
                    roles.append(role)
                if not step_ok:
                    unresolved = True
                    untyped.add(step.id)
                    continue
                types = {role.type for role in roles}
                if isinstance(step, ParallelStep) and types != {"review"}:
                    issues.append((where + ("parallel", ),
                                   f"{name}/{step.id}: parallel groups must contain only reviews"))
                kind = roles[0].type
                if step.onChanges is not None and (kind not in {"review", "approval"}
                                                   or step.onChanges not in tasks | untyped):
                    issues.append((where + ("onChanges", ),
                                   f"{name}/{step.id}: onChanges must name an earlier task step "
                                   "and is allowed only on review or approval steps"))
                if kind == "task":
                    tasks.add(step.id)
                if kind == "approval":
                    approvals.append(i)
                kinds[i] = kind
            if not unresolved and (kinds[len(steps) - 1] != "approval" or len(approvals) != 1):
                last = len(steps) - 1
                bad = sorted({last, *[i for i in approvals if i != last]})
                for i in bad:
                    issues.append((("pipelines", name, i),
                                   f"{name}: pipeline must end with exactly one approval step"))
        if issues:
            raise ConfigFieldErrors(issues)
        self._roles = resolved
        # engine.pipeline.freeze snapshots these roles and policy at job creation (§10.5).
        # TODO (plan §15.4, session 1.9): enforce the engine version gate in commands.
        return self

    def role_for(self, pipeline: str, execution_id: str) -> Role:
        return self._roles[pipeline, execution_id]


def template_config() -> dict[str, Any]:
    return json.loads(TEMPLATE.read_text(encoding="utf-8"))


def current_format(raw: Any) -> dict[str, Any]:
    """An independent copy of a config in the current format (version 2)."""
    if not isinstance(raw, dict):
        raise ValueError("Config must be an object")
    if raw.get("version") != 2:
        raise ValueError(f"Unsupported config version: {raw.get('version')!r}; expected 2")
    return copy.deepcopy(raw)


def engine_range(version: str | None = None) -> str:
    """PEP 440 range covering the running engine's major release.

    A prerelease such as ``1.0.0rc1`` sorts below the stable ``>=1.0`` bound, so fall
    back to the running version (minus any local segment) as the lower bound. That keeps
    a repository usable by the engine that created it while the next major stays excluded.
    """
    version = __version__ if version is None else version
    major = int(version.split(".", 1)[0])
    bound = f">={major}.0,<{major + 1}"
    if not versioning.matches(version, bound):
        return f">={version.split('+', 1)[0]},<{major + 1}"
    return bound


def validate_config(raw: dict[str, Any], *, root: str | Path) -> RepoConfig:
    """Validate a config; every ValidationError entry carries a real config field path."""
    try:
        return RepoConfig.model_validate(current_format(raw), context={"root": Path(root)})
    except ValidationError as exc:
        lines: list[Any] = []
        for entry in exc.errors():
            loc = tuple(entry["loc"])
            # Drop the union tag segment that follows a pipeline's step index.
            if len(loc) > 3 and loc[0] == "pipelines" and loc[3] in STEP_TAGS:
                loc = loc[:3] + loc[4:]
            error = entry.get("ctx", {}).get("error")
            if isinstance(error, ConfigFieldErrors):
                lines += [{
                    "type": "value_error",
                    "loc": loc + tuple(relative),
                    "input": entry["input"],
                    "ctx": {
                        "error": ValueError(message)
                    },
                } for relative, message in error.issues]
                continue
            line: dict[str, Any] = {"type": entry["type"], "loc": loc, "input": entry["input"]}
            if "ctx" in entry:
                line["ctx"] = entry["ctx"]
            lines.append(line)
        raise ValidationError.from_exception_data(exc.title, lines) from None


def preview_pipeline(config: RepoConfig, name: str) -> dict[str, Any]:
    """Describe a validated pipeline's stages, parallel groups and rework loops."""
    steps = config.pipelines[name]
    index_of = {step.id: i for i, step in enumerate(steps)}
    stages = []
    loops = []
    for i, step in enumerate(steps):
        executions = step.executions
        kind = config.role_for(name, executions[0].id).type
        parallel = isinstance(step, ParallelStep)
        stages.append({
            "index":
            i,
            "id":
            step.id,
            "label":
            step.label or step.id,
            "type":
            kind,
            "approval":
            kind == "approval",
            "parallel":
            parallel,
            "group":
            step.id if parallel else None,
            "executions": [{
                "id": e.id,
                "uses": e.uses,
                "provider": e.provider,
                "model": e.profiles[e.provider].model,
                "effort": e.profiles[e.provider].effort,
            } for e in executions],
        })
        if step.onChanges is not None:
            loops.append({
                "from": step.id,
                "to": step.onChanges,
                "fromIndex": i,
                "toIndex": index_of[step.onChanges],
                "maxReturns": config.maxRounds - 1,
            })
    return {
        "name": name,
        "default": name == config.defaultPipeline,
        "maxRounds": config.maxRounds,
        "stages": stages,
        "loops": loops,
    }


def load_config(root: str | Path) -> RepoConfig:
    root = Path(root).resolve()
    raw = json.loads((root / "shiptrail" / "config.json").read_text(encoding="utf-8-sig"))
    return validate_config(raw, root=root)


class GlobalConcurrency(ConfigModel):
    global_: Annotated[int, Field(ge=1, le=32)] = Field(default=6, alias="global")


class CliPaths(ConfigModel):
    claude: str | None = None
    codex: str | None = None
    opencode: str | None = None

    @field_validator("claude", "codex", "opencode")
    @classmethod
    def absolute_path(cls, value: str | None) -> str | None:
        if value is not None and not Path(value).is_absolute():
            raise ValueError("CLI path must be absolute")
        return value


class Ports(ConfigModel):
    range: str = "5100-5999"

    @field_validator("range")
    @classmethod
    def valid_range(cls, value: str) -> str:
        parts = value.split("-")
        if len(parts) != 2 or not all(p.isascii() and p.isdecimal() for p in parts):
            raise ValueError("ports.range must be start-end")
        start, end = map(int, parts)
        if not 1 <= start <= end <= 65535:
            raise ValueError("ports.range must satisfy 1 <= start <= end <= 65535")
        return value


class MachineSettings(ConfigModel):
    concurrency: GlobalConcurrency = Field(default_factory=GlobalConcurrency)
    cli: CliPaths = Field(default_factory=CliPaths)
    ports: Ports = Field(default_factory=Ports)


_MACHINE_KEYS = {"concurrency.global", "cli.claude", "cli.codex", "cli.opencode", "ports.range"}


def load_machine_settings(connection: sqlite3.Connection) -> MachineSettings:
    raw: dict[str, Any] = {}
    for key, value in connection.execute("SELECT key, value FROM settings"):
        if key in _MACHINE_KEYS:
            group, field = key.split(".")
            raw.setdefault(group, {})[field] = json.loads(value)
    return MachineSettings.model_validate(raw)


def save_machine_settings(connection: sqlite3.Connection,
                          settings: MachineSettings | dict[str, Any]) -> MachineSettings:
    raw = settings.model_dump(by_alias=True) if isinstance(settings, MachineSettings) else settings
    validated = MachineSettings.model_validate(raw)
    rows = [(f"{group}.{field}", json.dumps(value))
            for group, fields in validated.model_dump(by_alias=True).items()
            for field, value in fields.items()]
    with db.tx(connection):
        connection.executemany(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value", rows)
    return validated
