{ sources = [ "src/**/*.purs" ]
, name = "switch-to-audible-tab"
, dependencies =
  [ "effect"
  , "halogen"
  , "argonaut"
  , "prelude"
  , "aff"
  , "aff-promise"
  , "argonaut-codecs"
  , "arrays"
  , "either"
  , "foldable-traversable"
  , "maybe"
  , "newtype"
  , "profunctor-lenses"
  , "web-dom"
  ]
, packages = ./packages.dhall
}
