module Settings where

import Prelude

import Data.Maybe (Maybe(..))
import Effect.Aff (Aff)
import Halogen as H
import Halogen.HTML as HH
import Halogen.HTML.Events as HE
import Halogen.HTML.Properties as HP
import SettingsFFI (save)


type State =
  { includeMuted :: Boolean
  , allWindows :: Boolean
  , includeFirst :: Boolean
  , sortBackwards :: Boolean
  , menuOnTab :: Boolean
  , menuOnButton :: Boolean
  }


data CheckBox
  = IncludeMuted
  | AllWindows
  | IncludeFirst
  | SortBackwards
  | MenuOnTab
  | MenuOnButton


data Query a
  = Toggle CheckBox Boolean a


type Message = Unit


initialState :: State
initialState =
    { includeMuted: true
    , allWindows: true
    , includeFirst: true
    , sortBackwards: false
    , menuOnTab: true
    , menuOnButton: true
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
  render { includeMuted, allWindows, includeFirst, sortBackwards
         , menuOnTab, menuOnButton } =
    HH.div_
    [ HH.h3_ [ HH.text "GENERAL SETTINGS" ]

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
                 , HP.checked sortBackwards
                 , HE.onChecked (HE.input (Toggle SortBackwards))
                 , HP.id_ "sortBackwards"
                 ]
      , HH.label
        [ HP.for "sortBackwards" ]
        [ HH.text "When cycling through tabs, visit them in reverse order (i.e. right-to-left)" ]
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

    , HH.h3_ [ HH.text "CONTEXT MENUS" ]
    , HH.text "Context menus allow to manually mark tabs as audible."
    , HH.br_
    , HH.br_

    , HH.div_
      [ HH.input [ HP.type_ HP.InputCheckbox
                 , HP.checked menuOnTab
                 , HE.onChecked (HE.input (Toggle MenuOnTab))
                 , HP.id_ "menuOnTab"
                 ]
      , HH.label
        [ HP.for "menuOnTab" ]
        [ HH.text "Enable for tabs" ]
      ]

    , HH.div_
      [ HH.input [ HP.type_ HP.InputCheckbox
                 , HP.checked menuOnButton
                 , HE.onChecked (HE.input (Toggle MenuOnButton))
                 , HP.id_ "menuOnButton"
                 ]
      , HH.label
        [ HP.for "menuOnButton" ]
        [ HH.text "Enable for toolbar button" ]
      ]
    ]

  eval :: Query ~> H.ComponentDSL State Query Message Aff
  eval (Toggle checkbox value next) = do
    H.modify_ case checkbox of
      IncludeMuted  -> (_ { includeMuted  = value })
      AllWindows    -> (_ { allWindows    = value })
      IncludeFirst  -> (_ { includeFirst  = value })
      SortBackwards -> (_ { sortBackwards = value })
      MenuOnTab     -> (_ { menuOnTab     = value })
      MenuOnButton  -> (_ { menuOnButton  = value })
    values <- H.get
    H.liftAff (save values)
    pure next
