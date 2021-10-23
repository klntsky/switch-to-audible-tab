module SettingsFFI
       ( save
       , load
       , setFocus
       , isValidDomain
       )
where

import Prelude
import Effect.Aff (Aff)
import Data.Argonaut (Json)
import Control.Promise (Promise)
import Control.Promise as Promise
import Effect (Effect)
import Data.Argonaut.Decode (decodeJson)
import Data.Maybe (fromMaybe)
import Data.Either (hush)
import Web.DOM (Element)
import Data (ValidSettings)


save :: ValidSettings -> Aff Unit
save = Promise.toAffE <<< save_


load :: ValidSettings -> Aff ValidSettings
load a = map (fromMaybe a <<< hush <<< decodeJson) <<<
         Promise.toAffE $ load_ a

foreign import setFocus :: Element -> Effect Unit
foreign import save_ :: ValidSettings -> Effect (Promise Unit)
foreign import load_ :: ValidSettings -> Effect (Promise Json)
foreign import isValidDomain :: String -> Boolean
