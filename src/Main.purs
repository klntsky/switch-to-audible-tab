module Main where

import Prelude
import SettingsFFI (load)
import Effect (Effect)
import Settings (initialState, mkComponent)
import Halogen.Aff (awaitBody, runHalogenAff)
import Halogen.VDom.Driver (runUI)


main :: Effect Unit
main = do
  runHalogenAff do
    body <- awaitBody
    state <- load initialState
    runUI (mkComponent state) unit body
