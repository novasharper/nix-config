{
  bun,
  bun2nix,
  fetchFromGitHub,
  lib,
  pi-coding-agent-bun,
  piNix,
  stdenv,
  which,
  writeText,
}:

let
  piVersion = builtins.fromJSON (builtins.readFile "${piNix}/VERSION.json");
  version = lib.removePrefix "v" piVersion.rev;
  piSource = fetchFromGitHub {
    owner = "earendil-works";
    repo = "pi";
    inherit (piVersion) hash rev;
  };
  piBunNix = "${piNix}/coding-agent/bun.nix";
  bunInstallFlags =
    if stdenv.hostPlatform.isDarwin then
      [
        "--linker=hoisted"
        "--backend=copyfile"
        "--frozen-lockfile"
      ]
    else
      [
        "--linker=hoisted"
        "--frozen-lockfile"
      ];
  sandboxArch =
    if stdenv.hostPlatform.system == "x86_64-linux" then
      "x64"
    else if stdenv.hostPlatform.system == "aarch64-linux" then
      "arm64"
    else
      null;
  seccompDirectory = "vendor/seccomp/${sandboxArch}";

  # Shipped in $out and typechecked. The entry point comes first; the rest are
  # reached through its relative imports.
  extensionSources = [
    "index.ts"
    "sandbox.ts"
    "session.ts"
    "session-resources.ts"
    "policy.ts"
    "project-scan.ts"
    "environment.ts"
    "security.ts"
    "secrets.ts"
    "fs-paths.ts"
    "errors.ts"
  ];
  # Checked but never installed; installCheckPhase asserts the whole directory
  # is absent from $out.
  testDirectory = "tests";
  testSources = map (name: "${testDirectory}/${name}") [
    "test-support.ts"
    "pi-api.test-shim.ts"
    "index.test.ts"
    "sandbox.test.ts"
    "session.test.ts"
    "policy.test.ts"
    "project-scan.test.ts"
    "environment.test.ts"
    "security.test.ts"
    "secrets.test.ts"
  ];
  unitTestSources = builtins.filter (lib.hasSuffix ".test.ts") testSources;
  # Not built or shipped; it exists so the shim the tests substitute for the
  # real package is checked against that package's typings.
  conformanceSource = "${testDirectory}/pi-api.conformance.ts";
  # The seccomp asset paths are substituted into this file at build time.
  seccompSource = "policy.ts";
  sourcePackage = builtins.fromJSON (builtins.readFile ./package.json);

  # install -D so a source under tests/ creates its parent.
  installSources =
    directory: names:
    lib.concatMapStringsSep "\n" (
      name: "install -D -m 0644 ${./. + "/${name}"} ${directory}/${name}"
    ) names;
  packageJson = writeText "pi-shell-sandbox-package.json" (
    builtins.toJSON (
      sourcePackage
      // {
        inherit version;
        # pi loads extensions through jiti, which transpiles TypeScript and
        # resolves the entry's own imports, so the sources ship as written: one
        # declared entry point, its sibling modules beside it, and the runtime
        # dependency resolved through the node_modules symlink below.
        pi.extensions = [
          "./extensions/shell-sandbox/index.ts"
        ];
      }
    )
  );
  # Checks the extension against the real @earendil-works/pi-coding-agent and
  # @anthropic-ai/sandbox-runtime typings installed in node_modules. strict is
  # left off: the goal is catching API drift, not null-safety style.
  tsconfig = writeText "pi-shell-sandbox-tsconfig.json" (
    builtins.toJSON {
      compilerOptions = {
        module = "preserve";
        target = "es2023";
        lib = [ "es2023" ];
        types = [ "node" ];
        allowImportingTsExtensions = true;
        noEmit = true;
        skipLibCheck = true;
      };
      include = map (name: "extension/${name}") (extensionSources ++ [ conformanceSource ]);
    }
  );
  # --replace-fail: a placeholder that moves or disappears is a build failure
  # rather than a silently empty asset path.
  substituteSeccompPaths =
    if stdenv.isLinux then
      ''
        substituteInPlace extension/${seccompSource} \
          --replace-fail '@seccompBpfPath@' "$out/${seccompDirectory}/unix-block.bpf" \
          --replace-fail '@seccompApplyPath@' "$out/${seccompDirectory}/apply-seccomp"
      ''
    else
      ''
        substituteInPlace extension/${seccompSource} \
          --replace-fail '@seccompBpfPath@' "" \
          --replace-fail '@seccompApplyPath@' ""
      '';
in
assert lib.assertMsg (
  !stdenv.isLinux || sandboxArch != null
) "Pi shell sandbox supports Linux only on x86_64 and aarch64";

stdenv.mkDerivation {
  pname = "pi-shell-sandbox";
  inherit bunInstallFlags version;

  src = piSource;

  dontRunLifecycleScripts = true;
  nativeBuildInputs = [
    bun
    bun2nix.hook
  ]
  ++ lib.optionals stdenv.isDarwin [ which ];

  bunDeps = bun2nix.fetchBunDeps {
    bunNix =
      {
        copyPathToStore,
        fetchFromGitHub,
        fetchgit,
        fetchurl,
        ...
      }@args:
      import piBunNix (args // { workspaceRoot = piSource; });
  };

  postPatch = ''
    cp ${piNix}/bun.lock bun.lock

    mkdir extension
    ${installSources "extension" (extensionSources ++ testSources ++ [ conformanceSource ])}
  '';

  # Nothing is bundled, so the "build" is only the seccomp path substitution;
  # everything that could fail is a check. They run on any `nix build` as well
  # as under `nix flake check`, which exposes this derivation as a check.
  buildPhase = ''
    runHook preBuild

    ${substituteSeccompPaths}

    runHook postBuild
  '';

  doCheck = true;

  checkPhase = ''
    runHook preCheck

    # bun test strips types without checking them, and the tests run against
    # pi-api.test-shim.ts rather than the real package. Without this pass a
    # renamed or dropped option — exposeSessionEnvironment, say — would load as
    # a silently ignored no-op instead of failing the build.
    # pi-api.conformance.ts extends the same guarantee to the shim itself.
    #
    # pi's workspace packages carry no built dist/*.d.ts in the source tree, so
    # @earendil-works resolves to the built package instead. sandbox-runtime,
    # @types/node, and tsc itself still come from the workspace install.
    rm -rf node_modules/@earendil-works
    ln -s ${pi-coding-agent-bun}/lib/node_modules/@earendil-works \
      node_modules/@earendil-works
    cp ${tsconfig} tsconfig.json
    bun node_modules/typescript/bin/tsc --project tsconfig.json

    # The extension is checked against the workspace's sandbox-runtime but
    # resolves pi's at run time through the node_modules symlink. Both come from
    # pi's bun.lock, so they agree today; fail the build if they ever stop.
    if ! cmp -s \
      node_modules/@anthropic-ai/sandbox-runtime/package.json \
      ${pi-coding-agent-bun}/lib/node_modules/@anthropic-ai/sandbox-runtime/package.json
    then
      echo "sandbox-runtime differs between the typecheck and the runtime resolution" >&2
      exit 1
    fi

    # Run against a copy: index.ts is the only module importing pi's own
    # package, and the copy is where that import is swapped for the shim. The
    # installed sources keep the real import.
    cp -r extension test-tree
    substituteInPlace test-tree/index.ts \
      --replace-fail \
        'from "@earendil-works/pi-coding-agent";' \
        'from "./${testDirectory}/pi-api.test-shim.ts";'
    # Named explicitly: bun test treats a bare argument as a path filter over
    # everything it discovers, and the pi checkout this builds in carries its
    # own test files.
    bun test ${lib.concatMapStringsSep " " (name: "test-tree/${name}") unitTestSources}

    runHook postCheck
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/extensions/shell-sandbox"
    install -m 0444 ${packageJson} "$out/package.json"
    ${lib.concatMapStringsSep "\n" (
      name: ''install -D -m 0444 extension/${name} "$out/extensions/shell-sandbox/${name}"''
    ) extensionSources}

    # Resolves @anthropic-ai/sandbox-runtime (and its own dependency closure)
    # for the extension. A symlink into pi's own install rather than a copy, so
    # the extension and pi share one instance of the runtime.
    ln -s ${pi-coding-agent-bun}/lib/node_modules "$out/node_modules"
  ''
  + lib.optionalString stdenv.isLinux ''
    mkdir -p "$out/${seccompDirectory}"
    install -m 0444 \
      "node_modules/@anthropic-ai/sandbox-runtime/${seccompDirectory}/unix-block.bpf" \
      "$out/${seccompDirectory}/unix-block.bpf"
    install -m 0555 \
      "node_modules/@anthropic-ai/sandbox-runtime/${seccompDirectory}/apply-seccomp" \
      "$out/${seccompDirectory}/apply-seccomp"
  ''
  + ''
    runHook postInstall
  '';

  doInstallCheck = true;

  installCheckPhase = ''
    runHook preInstallCheck

    # Load the installed tree the way pi does — jiti, no bundler — so a broken
    # relative import or an unresolvable dependency fails here instead of
    # leaving pi to start with no extension and therefore no shell guard.
    install -m 0644 ${./load-smoke-test.mjs} load-smoke-test.mjs
    bun load-smoke-test.mjs "$out"

    # Test-only sources must not ship.
    test ! -e "$out/extensions/shell-sandbox/${testDirectory}"

    runHook postInstallCheck
  '';
}
