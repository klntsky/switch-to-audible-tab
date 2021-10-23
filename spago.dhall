{ sources = [ "src/**/*.purs" ]
, name = "switch-to-audible-tab"
, dependencies =
  [ "aff"
  , "aff-promise"
  , "argonaut"
  , "argonaut-codecs"
  , "arrays"
  , "control"
  , "effect"
  , "either"
  , "foldable-traversable"
  , "halogen"
  , "integers"
  , "maybe"
  , "newtype"
  , "prelude"
  , "profunctor-lenses"
  , "tuples"
  , "web-dom"
  ]
, packages = ./packages.dhall
}
