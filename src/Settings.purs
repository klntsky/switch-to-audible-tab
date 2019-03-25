module Settings where

import Prelude

import Data.Array (mapWithIndex)
import Data.Array as A
import Data.Lens (set, (%~))
import Data.Lens.Index (ix)
import Data.Lens.Record (prop)
import Data.Maybe (Maybe(..), fromMaybe)
import Data.Symbol (SProxy(..))
import Effect.Aff (Aff)
import Halogen as H
import Halogen.HTML (HTML, br_, div_, h3_, input, label, text)
import Halogen.HTML.Events (onChecked, onClick)
import Halogen.HTML.Events as HE
import Halogen.HTML.Properties
import SettingsFFI (save)
import Web.HTML (window)
import Web.HTML.Window (confirm)

type State =
  { includeMuted :: Boolean
  , allWindows :: Boolean
  , includeFirst :: Boolean
  , sortBackwards :: Boolean
  , menuOnTab :: Boolean
  , menuOnButton :: Boolean
  , markAsAudible :: Array { domain :: String
                           , enabled :: Boolean
                           , withSubdomains :: Boolean
                           }
  }


data CheckBox
  = IncludeMuted
  | AllWindows
  | IncludeFirst
  | SortBackwards
  | MenuOnTab
  | MenuOnButton
  | FilterEnabled Int
  | FilterWithSubdomains Int


data Button
  = RemoveDomain Int
  | RestoreDefaults


data Input
  = DomainField Int String


data Query a
  = Toggle CheckBox Boolean a
  | Click Button a
  | TextInput Input a


type Message = Unit


initialState :: State
initialState =
    { includeMuted: true
    , allWindows: true
    , includeFirst: true
    , sortBackwards: false
    , menuOnTab: true
    , menuOnButton: true
    , markAsAudible:
      [ { domain: "soundcloud.com"
        , enabled: false
        , withSubdomains: false
        }
      , { domain: "bandcamp.com"
        , enabled: false
        , withSubdomains: true
        }
      , { domain: "youtube.com"
        , enabled: false
        , withSubdomains: false
        }
      ]
    }


mkComponent :: State -> H.Component HTML Query Unit Message Aff
mkComponent state = H.component
    { initialState: const state
    , render
    , eval
    , receiver: const Nothing
    }
  where
  render :: State -> H.ComponentHTML Query
  render { includeMuted, allWindows, includeFirst, sortBackwards
         , menuOnTab, menuOnButton, markAsAudible } =
    div_
    [ h3_ [ text "GENERAL SETTINGS" ]

    , div_
      [ input [ type_ InputCheckbox
                 , checked includeMuted
                 , onChecked (HE.input (Toggle IncludeMuted))
                 , id_ "includeMuted"
                 ]
      , label
        [ for "includeMuted" ]
        [ text "Include muted tabs" ]
      ]

    , div_
      [ input [ type_ InputCheckbox
                 , checked allWindows
                 , onChecked (HE.input (Toggle AllWindows))
                 , id_ "allWindows"
                 ]
      , label
        [ for "allWindows" ]
        [ text "Search for audible tabs in all windows" ]
      ]

    , div_
      [ input [ type_ InputCheckbox
              , checked sortBackwards
              , onChecked (HE.input (Toggle SortBackwards))
              , id_ "sortBackwards"
              ]
      , label
        [ for "sortBackwards" ]
        [ text "When cycling through tabs, visit them in reverse order (i.e. right-to-left)" ]
      ]

    , div_
      [ input [ type_ InputCheckbox
              , checked includeFirst
              , onChecked (HE.input (Toggle IncludeFirst))
              , id_ "includeFirst"
              ]
      , label
        [ for "includeFirst" ]
        [ text "When cycling through tabs, also include first tab from which the cycle was started" ]
      ]

    , h3_ [ text "CONTEXT MENUS" ]
    , text "Context menus allow to manually mark tabs as audible."
    , br_
    , br_

    , div_
      [ input [ type_ InputCheckbox
              , checked menuOnTab
              , onChecked (HE.input (Toggle MenuOnTab))
              , id_ "menuOnTab"
              ]
      , label
        [ for "menuOnTab" ]
        [ text "Enable for tabs" ]
      ]

    , div_
      [ input [ type_ InputCheckbox
              , checked menuOnButton
              , onChecked (HE.input (Toggle MenuOnButton))
              , id_ "menuOnButton"
              ]
      , label
        [ for "menuOnButton" ]
        [ text "Enable for toolbar button" ]
      ]

    , h3_ [ text "MARK DOMAINS" ]
    , text "Enter below domains which you want to mark as audible permanently. This may be useful when browsing these sites a lot."
    , br_
    , br_

    , div_ $
      markAsAudible `flip mapWithIndex`
      \ix { domain, enabled, withSubdomains } ->
      let id = "withSubdomains" <> show ix in
      div_
      [ input [ type_ InputCheckbox
              , onChecked $ HE.input $ Toggle $ FilterEnabled ix
              , checked enabled ]
      , input [ value domain
              , HE.onValueInput $ HE.input (TextInput <<< DomainField ix)
              ]
      , input [ type_ InputCheckbox
              , onChecked $ HE.input $ Toggle $ FilterWithSubdomains ix
              , id_ id
              , checked withSubdomains
              ]
      , label
        [ for id ]
        [ text "Include subdomains" ]
      , input [ type_ InputButton
              , onClick  (HE.input $ const (Click (RemoveDomain ix)))
              , value "Remove"
              ]
      ]
    , input [ type_ InputButton
            , onClick (HE.input $ const (Click RestoreDefaults))
            , value "Restore defaults"
            ]
    ]

  eval :: Query ~> H.ComponentDSL State Query Message Aff
  eval (Click button next) = do
    case button of
      RemoveDomain index ->
        H.modify_ $
        prop markAsAudible_ %~
        (\arr -> fromMaybe arr $ A.deleteAt index arr)
      RestoreDefaults -> do
        confirmed <- H.liftEffect $
          window >>= confirm "Do you really want to reset the settings?"
        when confirmed do
          H.put initialState

    pure next

  eval (TextInput input next) = do
    case input of
      DomainField index str ->
        H.modify_ $
        prop markAsAudible_ %~
        ix index %~
        set (prop domain_) str

    pure next
  eval (Toggle checkbox value next) = do
    H.modify_ case checkbox of
      IncludeMuted  -> (_ { includeMuted  = value })
      AllWindows    -> (_ { allWindows    = value })
      IncludeFirst  -> (_ { includeFirst  = value })
      SortBackwards -> (_ { sortBackwards = value })
      MenuOnTab     -> (_ { menuOnTab     = value })
      MenuOnButton  -> (_ { menuOnButton  = value })
      FilterEnabled index ->
        prop markAsAudible_ %~
        ix index %~
        set (prop enabled_) value
      FilterWithSubdomains index ->
        prop markAsAudible_ %~
        ix index %~
        set (prop withSubdomains_) value

    values <- H.get
    H.liftAff (save values)
    pure next

  withSubdomains_ = SProxy :: SProxy "withSubdomains"
  domain_ = SProxy :: SProxy "domain"
  enabled_ = SProxy :: SProxy "enabled"
  markAsAudible_ = SProxy :: SProxy "markAsAudible"
