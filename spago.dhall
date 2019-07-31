{ sources =
    [ "src/**/*.purs", "test/**/*.purs" ]
, name =
    "my-project"
, dependencies =
    [ "effect", "halogen", "argonaut", "prelude", "aff", "aff-promise" ]
, packages =
    ./packages.dhall
}
