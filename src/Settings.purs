module Settings where

import Prelude

import Data.Array (mapWithIndex)
import Data.Array as A
import Data.Lens (over, set, view, (%~))
import Data.Lens.Index (ix)
import Data.Lens.Record (prop)
import Data.Maybe (Maybe(..), fromMaybe)
import Data.Monoid (guard)
import Data.Newtype (wrap)
import Data.Symbol (SProxy(..))
import Data.Traversable (for_)
import Effect.Aff (Aff)
import Halogen as H
import Halogen.HTML (HTML, br_, div_, h3_, input, label, text)
import Halogen.HTML.Events (onChecked, onClick)
import Halogen.HTML.Events as HE
import Halogen.HTML.Properties (InputType(..), checked, class_, for, id_, ref, type_, value, title)
import SettingsFFI as FFI


type State =
  { pageState :: PageState
  , validationResult :: ValidationResult
  , settings :: Settings
  }

data PageState = Normal | RestoreConfirmation

derive instance eqPageState :: Eq PageState

type ValidationResult = Array Boolean

type Settings =
  { includeMuted :: Boolean
  , allWindows :: Boolean
  , includeFirst :: Boolean
  , sortBackwards :: Boolean
  , menuOnTab :: Boolean
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
  | DomainEnabled Int
  | DomainWithSubdomains Int

data Button
  = RemoveDomain Int
  | RestoreDefaults
  | AddDomain
  | ConfirmRestore
  | CancelRestore

data Input
  = DomainField Int String

data Query a
  = Toggle CheckBox Boolean a
  | Click Button a
  | TextInput Input a

type Action = Unit

data Message = Unit

initialSettings :: Settings
initialSettings =
  { includeMuted: true
  , allWindows: true
  , includeFirst: true
  , sortBackwards: false
  , menuOnTab: false
  , markAsAudible: []
  }

mkComponent :: Settings -> H.Component HTML Query Action Message Aff
mkComponent s = H.component
    { initialState: const { pageState: Normal
                          , validationResult: []
                          , settings: s
                          }
    , render
    , eval
    , receiver: const Nothing
    }
  where

  render :: State -> H.ComponentHTML Query
  render ({ pageState
          , validationResult
          , settings: { includeMuted
                      , allWindows
                      , includeFirst
                      , sortBackwards
                      , menuOnTab
                      , markAsAudible } }) =
    div_ $
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
        [ text "When cycling through tabs, also include the first tab from which the cycle was started" ]
      ]

    , h3_ [ text "CONTEXT MENUS" ]
    , text "Context menus allow to manually mark tabs as audible. You can always do this by context-clicking the extension icon. A tiny indicator will be added to the extension button, showing that currently active tab was manually marked."
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
        [ text "Also enable 'Mark as audible' context menu option for tabs" ]
      ]

    , h3_ [ text "MARK DOMAINS" ]
    , text $
      "Enter below domains which you want to mark as audible permanently."
    , br_
    , br_

    , div_ $
      markAsAudible `flip mapWithIndex`
      \ix { domain, enabled, withSubdomains } ->
      let id = "withSubdomains" <> show ix in
      div_ $
      [
        input
        [ type_ InputCheckbox
        , onChecked $ HE.input $ Toggle $ DomainEnabled ix
        , id_ $ "domain-checkbox-"  <> show ix
        , title $ if enabled
                  then "Enabled"
                  else "Disabled"
        , checked enabled ]

      , input $
        [ value domain
        , HE.onValueInput $ HE.input (TextInput <<< DomainField ix)
        ] <>

        -- Highlight if invalid
        guard (Just false == validationResult A.!! ix)
        [ class_ (wrap "invalid-domain")
        , title "Invalid domain!" ]

      , input [ type_ InputCheckbox
              , onChecked $ HE.input $ Toggle $ DomainWithSubdomains ix
              , id_ id
              , checked withSubdomains
              ]
      , label
        [ for id
        , title "Whether to include all subdomains of this domain"  ]
        [ text "Include subdomains" ]
      , input [ type_ InputButton
              , class_ (wrap "button")
              , onClick  (HE.input $ const (Click (RemoveDomain ix)))
              , value "Remove"
              , title "Remove this domain from the list"
              ]
      ]

    , input [ type_ InputButton
            , class_ (wrap "button")
            , onClick (HE.input $ const (Click AddDomain))
            , value "Add domain"
            ]

    , br_
    , br_
    ] <>

    case pageState of
      Normal ->
        [ input [ type_ InputButton
                , onClick (HE.input $ const (Click RestoreDefaults))
                , id_ "button-restore"
                , class_ (wrap "button")
                , value "Restore defaults"
                ]
        ]

      RestoreConfirmation ->
        [ text "Do you really want to reset the settings?"
        , input [ type_ InputButton
                , onClick $ HE.input $ const $ Click ConfirmRestore
                , class_ (wrap "button")
                , value "OK"
                ]
        , input [ type_ InputButton
                , onClick $ HE.input $ const $ Click CancelRestore
                , class_ (wrap "button")
                , value "Cancel"
                , ref cancelRestoreRef
                ]
        ]

  eval :: Query ~> H.ComponentDSL State Query Message Aff
  eval (Click button next) = do

    case button of
      RemoveDomain index -> do
        modifySettings $
          _markAsAudible %~
          (\arr -> fromMaybe arr $ A.deleteAt index arr)

      AddDomain -> do
        modifySettings $
          _markAsAudible %~
          (_ <> pure { domain: ""
                     , enabled: true
                     , withSubdomains: false
                     })

      RestoreDefaults -> do
        setPageState RestoreConfirmation
        H.getRef cancelRestoreRef >>= \maybeElem -> do
          for_ maybeElem $ H.liftEffect <<< FFI.setFocus

      ConfirmRestore -> do
        modifySettings $ const initialSettings
        setPageState Normal

      CancelRestore -> do
        setPageState Normal

    saveSettings
    pure next

  eval (TextInput input next) = do
    case input of
      DomainField index str -> do
        modifySettings $
          _markAsAudible %~
          ix index %~
          set _domain str
    saveSettings
    pure next

  eval (Toggle checkbox value next) = do
    modifySettings $
      case checkbox of
        IncludeMuted  -> (_ { includeMuted  = value })
        AllWindows    -> (_ { allWindows    = value })
        IncludeFirst  -> (_ { includeFirst  = value })
        SortBackwards -> (_ { sortBackwards = value })
        MenuOnTab     -> (_ { menuOnTab     = value })

        DomainEnabled index ->
          _markAsAudible %~
          ix index %~
          set _enabled value

        DomainWithSubdomains index ->
          _markAsAudible %~
          ix index %~
          set _withSubdomains value

    saveSettings
    pure next

  saveSettings = do
    settings <- H.gets $ view _settings
    let validationResult = validate settings
    H.modify_ $ over _validationResult $
      const validationResult
    when (A.foldr conj true validationResult) do
      H.liftAff do
        FFI.save settings

  validate :: Settings -> ValidationResult
  validate settings = settings #
    view _markAsAudible <#>
    view _domain <#>
    FFI.isValidDomain

  modifySettings = H.modify_ <<< over _settings
  setPageState = H.modify_ <<< set _pageState

  cancelRestoreRef = wrap "cancel-restore"

  _settings = prop (SProxy :: SProxy "settings")
  _pageState = prop (SProxy :: SProxy "pageState")
  _withSubdomains = prop (SProxy :: SProxy "withSubdomains")
  _domain = prop (SProxy :: SProxy "domain")
  _enabled = prop (SProxy :: SProxy "enabled")
  _markAsAudible = prop (SProxy :: SProxy "markAsAudible")
  _validationResult = prop (SProxy :: SProxy "validationResult")
