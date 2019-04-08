module Main where

import Prelude
import SettingsFFI (load)
import Effect (Effect)
import Settings (initialSettings, mkComponent)
import Halogen.Aff (awaitBody, runHalogenAff)
import Halogen.VDom.Driver (runUI)

main :: Effect Unit
main = do
  runHalogenAff do
    body <- awaitBody
    state <- load initialSettings
    runUI (mkComponent state) unit body
