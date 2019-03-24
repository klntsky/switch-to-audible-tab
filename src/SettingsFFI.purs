module SettingsFFI
       ( save
       , load
       )
where

import Prelude
import Effect.Aff (Aff)
import Data.Argonaut (Json)
import Control.Promise (Promise)
import Control.Promise as Promise
import Effect (Effect)
import Data.Argonaut.Encode (class EncodeJson, encodeJson)
import Data.Argonaut.Decode (class DecodeJson, decodeJson)
import Data.Maybe (fromMaybe)
import Data.Either (hush)


save :: forall a.
        EncodeJson a => DecodeJson a =>
        a -> Aff Unit
save = Promise.toAffE <<< save_ <<< encodeJson


load :: forall a.
        EncodeJson a => DecodeJson a =>
        a -> Aff a
load a = map (fromMaybe a <<< hush <<< decodeJson) <<<
         Promise.toAffE <<< load_ $ encodeJson a


foreign import save_ :: Json -> Effect (Promise Unit)
foreign import load_ :: Json -> Effect (Promise Json)
