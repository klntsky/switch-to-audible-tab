module Settings where

import Prelude

import SettingsFFI (save)
import Data.Maybe (Maybe(..))

import Halogen as H
import Effect.Aff (Aff)
import Halogen.HTML as HH
import Halogen.HTML.Events as HE
import Halogen.HTML.Properties as HP


type State =
  { includeMuted :: Boolean
  , allWindows :: Boolean
  , includeFirst :: Boolean
  , sortBackwards :: Boolean
  }


data CheckBox
  = IncludeMuted
  | AllWindows
  | IncludeFirst
  | SortBackwards


data Query a
  = Toggle CheckBox Boolean a


type Message = Unit


initialState :: State
initialState =
    { includeMuted: true
    , allWindows: true
    , includeFirst: true
    , sortBackwards: false
    }


mkComponent :: State -> H.Component HH.HTML Query Unit Message Aff
mkComponent state = H.component
    { initialState: const state
    , render
    , eval
    , receiver: const Nothing
    }
  where

  render :: State -> H.ComponentHTML Query
  render { includeMuted, allWindows, includeFirst, sortBackwards } =
    HH.div_
    [ HH.h1_ [ HH.img [ HP.id_ "logo"
                      , HP.src "../img/128.png"
                      , HP.alt "logo" ]
             , HH.text "settings"
             ]

    , HH.div_
      [ HH.input [ HP.type_ HP.InputCheckbox
                 , HP.checked includeMuted
                 , HE.onChecked (HE.input (Toggle IncludeMuted))
                 , HP.id_ "includeMuted"
                 ]
      , HH.label
        [ HP.for "includeMuted" ]
        [ HH.text "Include muted tabs" ]
      ]

    , HH.div_
      [ HH.input [ HP.type_ HP.InputCheckbox
                 , HP.checked allWindows
                 , HE.onChecked (HE.input (Toggle AllWindows))
                 , HP.id_ "allWindows"
                 ]
      , HH.label
        [ HP.for "allWindows" ]
        [ HH.text "Search for audible tabs in all windows" ]
      ]

    , HH.div_
      [ HH.input [ HP.type_ HP.InputCheckbox
                 , HP.checked includeFirst
                 , HE.onChecked (HE.input (Toggle IncludeFirst))
                 , HP.id_ "includeFirst"
                 ]
      , HH.label
        [ HP.for "includeFirst" ]
        [ HH.text "When cycling through tabs, also include first tab from which the cycle was started" ]
      ]

    , HH.div_
      [ HH.input [ HP.type_ HP.InputCheckbox
                 , HP.checked sortBackwards
                 , HE.onChecked (HE.input (Toggle SortBackwards))
                 , HP.id_ "sortBackwards"
                 ]
      , HH.label
        [ HP.for "sortBackwards" ]
        [ HH.text "When cycling through tabs, visit them in reverse order (i.e. right-to-left)" ]
      ]
    ]

  eval :: Query ~> H.ComponentDSL State Query Message Aff
  eval (Toggle checkbox value next) = do
    H.modify_ (case checkbox of
      IncludeMuted  -> (_ { includeMuted  = value })
      AllWindows    -> (_ { allWindows    = value })
      IncludeFirst  -> (_ { includeFirst  = value })
      SortBackwards -> (_ { sortBackwards = value }))
    values <- H.get
    H.liftAff (save values)
    pure next
