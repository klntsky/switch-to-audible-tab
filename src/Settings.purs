module Settings where

import Prelude

import Control.Alternative as Alt
import Data.Array (mapWithIndex)
import Data.Array as A
import Data.Either (Either(..))
import Data.Foldable (and)
import Data.Int as Int
import Data.Lens (over, set, to, view, (%~), (.~), (^.))
import Data.Lens.Index (ix)
import Data.Lens.Record (prop)
import Data.Maybe (Maybe(..), fromMaybe, isJust)
import Data.Monoid as M
import Data.Newtype (wrap)
import Data.Symbol (SProxy(..))
import Data.Traversable (for_)
import Data.Tuple.Nested ((/\))
import Effect.Aff (Aff)
import Halogen as H
import Halogen.HTML (a, br_, div_, h3_, input, label, text, span)
import Halogen.HTML.Events (onChecked, onClick)
import Halogen.HTML.Events as HE
import Halogen.HTML.Properties (InputType(..), checked, class_, for, id, ref, type_, value, title, href, target)
import Halogen.HTML.Properties as HP

import SettingsFFI as FFI
import Data (ValidSettings)


type State =
  { pageState :: PageState
  , validationResult :: ValidationResult
  , settings :: Settings
  }

data PageState = Normal | RestoreConfirmation

derive instance eqPageState :: Eq PageState

type ValidationResult =
  { websites :: Array Boolean
  , isValidTimeout :: Boolean
  , isValidDuration :: Boolean
  }

goodValidationResult :: ValidationResult
goodValidationResult =
  { websites: []
  , isValidTimeout: true
  , isValidDuration: true
  }

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
  , websitesOnlyIfNoAudible :: Boolean
  , followNotifications :: Boolean
  , notificationsTimeout :: String
  , maxNotificationDuration :: String
  , notificationsFirst :: Boolean
  }

data CheckBox
  = IncludeMuted
  | AllWindows
  | IncludeFirst
  | SortBackwards
  | MenuOnTab
  | DomainEnabled Int
  | DomainWithSubdomains Int
  | WebsitesOnlyIfNoAudible
  | FollowNotifications
  | NotificationsFirst

data Button
  = RemoveDomain Int
  | RestoreDefaults
  | AddDomain
  | ConfirmRestore
  | CancelRestore

data Input
  = DomainField Int String
  | TimeoutField String
  | DurationField String

data Action
  = Toggle CheckBox Boolean
  | Click Button
  | TextInput Input

-- This should be synchronised with background.js
initialSettings :: ValidSettings
initialSettings =
  { includeMuted: true
  , allWindows: true
  , includeFirst: true
  , sortBackwards: false
  , menuOnTab: false
  , markAsAudible: []
  , websitesOnlyIfNoAudible: false
  , followNotifications: true
  , notificationsTimeout: 10
  , maxNotificationDuration: 10
  , notificationsFirst: true
  }

toRuntimeSettings :: ValidSettings -> Settings
toRuntimeSettings =
  (_notificationsTimeout %~ show) >>> (_maxNotificationDuration %~ show)

mkComponent :: forall i q o. ValidSettings -> H.Component q i o Aff
mkComponent s = H.mkComponent
    { initialState: const
      { pageState: Normal
      , validationResult: goodValidationResult
      , settings: toRuntimeSettings s
      }
    , render
    , eval: H.mkEval $ H.defaultEval { handleAction = handleAction }
    }

render :: forall m. State -> H.ComponentHTML Action () m
render state = div_
  [ renderGeneralSettings state
  , renderNotifications state
  , renderContextMenu state
  , renderDomains state
  , br_, br_
  , renderRestoreDefaults state.pageState
  ]

renderGeneralSettings :: forall m. State -> H.ComponentHTML Action () m
renderGeneralSettings
  { settings: { includeMuted, allWindows, includeFirst, sortBackwards } } =
  div_
  [ h3_ [ text "HOTKEY" ]
  , text "Firefox implements unified UI for hotkey preferences. Follow "
  , a
    [ href "https://support.mozilla.org/en-US/kb/manage-extension-shortcuts-firefox"
    , target "_blank" ]
    [ text "this instruction" ]
  , text " to change the default hotkey."
  , h3_ [ text "GENERAL SETTINGS" ]
  , div_
    [ input [ type_ InputCheckbox
               , checked includeMuted
               , onChecked $ Toggle IncludeMuted
               , id "includeMuted"
               ]
    , label
      [ for "includeMuted" ]
      [ text "Include muted tabs" ]
    , tooltip "Treat tabs muted by the user as audible"
    ]
  , div_
    [ input [ type_ InputCheckbox
               , checked allWindows
               , onChecked $ Toggle AllWindows
               , id "allWindows"
               ]
    , label
      [ for "allWindows" ]
      [ text "Search for audible tabs in all windows" ]
    ]
  , div_
    [ input [ type_ InputCheckbox
            , checked sortBackwards
            , onChecked $ Toggle SortBackwards
            , id "sortBackwards"
            ]
    , label
      [ for "sortBackwards" ]
      [ text "Loop in reverse order" ]
    , tooltip "When cycling through tabs, visit them in reverse order (i.e. right-to-left). May be useful, because new tabs usually appear last"
    ]
  , div_
    [ input [ type_ InputCheckbox
            , checked includeFirst
            , onChecked $ Toggle IncludeFirst
            , id "includeFirst"
            ]
    , label
      [ for "includeFirst" ]
      [ text "Include initial tab" ]
    , tooltip "When cycling through tabs, also include the first tab from which the cycle was started"
    ]
  ]

renderNotifications :: forall m o. State -> H.ComponentHTML Action o m
renderNotifications { validationResult, settings } = div_
  [ h3_ [ text "NOTIFICATIONS" ]
  , input [ type_ InputCheckbox
          , checked settings.followNotifications
          , onChecked $ Toggle FollowNotifications
          , id "notifications"
          ]
  , label
    [ for "notifications" ]
    [ text "Follow notifications" ]
  , tooltip $ "Some websites play short notification sounds when user's attention is needed. This option allows to react to a notification during some fixed period of time after the notification sound has ended. A sound is treated as a notification if it is not coming from currently active tab AND its duration is less than notification duration limit (currently set to " <> settings.maxNotificationDuration <> " seconds)."
  , br_
  , input $
    [ type_ InputCheckbox
    , checked settings.notificationsFirst
    , onChecked $ Toggle NotificationsFirst
    , id "notifications-first"
    ] <>
    notificationsDisabledClass
  , label
    ([ for "notifications-first" ] <> notificationsDisabledClassLabel)
    [ text "Prioritize notifications" ]
  , tooltip $ "When checked, tabs with notifications will always be shown first, before ordinary audible tabs."
  , br_
  , label notificationsDisabledClassLabel
    [ text "Keep notifications for: " ]
  , input $
    [ type_ InputNumber
    , value settings.notificationsTimeout
    , HE.onValueInput $ TextInput <<< TimeoutField
    , id "timeout-field"
    ] <>
    -- Highlight if invalid
    M.guard (not validationResult.isValidTimeout)
    [ class_ (wrap "invalid")
    , title "Invalid timeout value (must be a non-negative number)"
    ] <>
    notificationsDisabledClass
  , label notificationsDisabledClassLabel [ text " s." ]
  , tooltip "Time interval in seconds during which the addon will treat the tab that played notification sound as audible (after the sound has stopped)"
  , br_
  , label notificationsDisabledClassLabel
    [ text "Notification duration limit: " ]
  , input $
    [ type_ InputNumber
    , value settings.maxNotificationDuration
    , HE.onValueInput $ TextInput <<< DurationField
    , id "duration-field"
    ] <>
    -- Highlight if invalid
    M.guard (not validationResult.isValidDuration)
    [ class_ (wrap "invalid")
    , title "Invalid duration value (must be a non-negative number)"
    ] <>
    notificationsDisabledClass
  , label notificationsDisabledClassLabel
    [ text " s." ]
  , tooltip "Used to decide if a sound is a notification or not. If a tab remains audible for less than this number of seconds, it will be treated as a tab with notification. 10 seconds is the recommended value."
  ]
  where
    notificationsDisabledClass
      :: forall rest p. Array (HP.IProp (class :: String, disabled :: Boolean | rest) p)
    notificationsDisabledClass =
      M.guard (not settings.followNotifications) [ class_ (wrap "disabled"), HP.disabled true ]
    notificationsDisabledClassLabel
      :: forall rest p. Array (HP.IProp (class :: String | rest) p)
    notificationsDisabledClassLabel =
      M.guard (not settings.followNotifications) [ class_ (wrap "disabled") ]

renderContextMenu :: forall m o. State -> H.ComponentHTML Action o m
renderContextMenu { settings: { menuOnTab } } = div_
  [ h3_ [ text "CONTEXT MENU" ]
  , div_
    [ input [ type_ InputCheckbox
            , checked menuOnTab
            , onChecked $ Toggle MenuOnTab
            , id "menuOnTab"
            ]
    , label
      [ for "menuOnTab" ]
      [ text "Enable 'Mark as audible' context menu option for tabs" ]
    , tooltip "Adds ability to manually mark tabs as audible. You can always do this by right-clicking the extension icon. A tiny indicator will be added to the extension button, showing that currently active tab was manually marked."
    ]
  ]

renderDomains :: forall m. State -> H.ComponentHTML Action () m
renderDomains { validationResult, settings: { markAsAudible, websitesOnlyIfNoAudible } } = div_
  [ h3_ [ text "MARK DOMAINS" ]
  , text $
    "Domains that will be marked as audible permanently."
  , tooltip "List the streaming services you use to navigate to them quickly"
  , br_
  , div_ $
    markAsAudible `flip mapWithIndex`
    \ix { domain, enabled, withSubdomains } ->
    let elId = "withSubdomains" <> show ix in
    div_ $
    [
      input
      [ type_ InputCheckbox
      , onChecked $ Toggle (DomainEnabled ix)
      , id $ "domain-checkbox-"  <> show ix
      , title $ if enabled
                then "Enabled"
                else "Disabled"
      , checked enabled ]
    , input $
      [ value domain
      , type_ InputText
      , HE.onValueInput $ TextInput <<< DomainField ix
      ] <>
      -- Highlight if invalid
      M.guard (Just false == validationResult.websites A.!! ix)
      [ class_ (wrap "invalid")
      , title "Invalid domain!" ]
    , input [ type_ InputCheckbox
            , onChecked $ Toggle (DomainWithSubdomains ix)
            , id elId
            , checked withSubdomains
            ]
    , label
      [ for elId
      , title "Whether to include all subdomains of this domain"  ]
      [ text "Include subdomains" ]
    , input [ type_ InputButton
            , class_ $ wrap "button"
            , onClick $ const $ Click $ RemoveDomain ix
            , value "Remove"
            , title "Remove this domain from the list"
            ]
    ]
  , input [ type_ InputButton
          , class_ $ wrap "button"
          , onClick $ const $ Click AddDomain
          , value "Add domain"
          ]
  , br_
  , div_
    [ input [ type_ InputCheckbox
            , checked websitesOnlyIfNoAudible
            , onChecked $ Toggle WebsitesOnlyIfNoAudible
            , id "websitesNoAudible"
            ]
    , label
      [ for "websitesNoAudible" ]
      [ text
        "Only include domains if there are no \"actually\" audible tabs."
      , tooltip "Motivation is that when the sound has stopped, the user may want to jump to the tab where they can click \"play\" again (e.g. a bandcamp tab). But while the sound is playing, there is no reason to cycle through all open tabs from marked websites, because only one of them has sound."
      ]
    ]
  ]

renderRestoreDefaults :: forall m. PageState -> H.ComponentHTML Action () m
renderRestoreDefaults pageState = div_ case pageState of
  Normal ->
    [ input [ type_ InputButton
            , onClick $ const $ Click RestoreDefaults
            , id "button-restore"
            , class_ (wrap "button")
            , value "Restore defaults"
            ]
    ]
  RestoreConfirmation ->
    [ text "Do you really want to reset the settings?"
    , input [ type_ InputButton
            , onClick $ const $ Click ConfirmRestore
            , class_ $ wrap "button"
            , value "OK"
            ]
    , input [ type_ InputButton
            , onClick $ const $ Click CancelRestore
            , class_ $ wrap "button"
            , value "Cancel"
            , ref cancelRestoreRef
            ]
    ]

tooltip :: forall a o m. String -> H.ComponentHTML a o m
tooltip str = span [ class_ (wrap "tooltip") ]
  [ text "?"
  , span
    [ class_ (wrap "tooltiptext") ]
    [ text str ]
  ]

handleAction :: forall o. Action -> H.HalogenM State Action () o Aff Unit
handleAction (Click button) = do
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
      modifySettings $ const $ toRuntimeSettings initialSettings
      setPageState Normal
    CancelRestore -> do
      setPageState Normal
  saveSettings
handleAction (TextInput input) = do
  case input of
    DomainField index str -> do
      modifySettings $ _markAsAudible <<< ix index <<< _domain .~ str
    TimeoutField str ->
      modifySettings $ _notificationsTimeout .~ str
    DurationField str ->
      modifySettings $ _maxNotificationDuration .~ str
  saveSettings
handleAction (Toggle checkbox value) = do
  modifySettings $
    case checkbox of
      IncludeMuted  -> (_ { includeMuted  = value })
      AllWindows    -> (_ { allWindows    = value })
      IncludeFirst  -> (_ { includeFirst  = value })
      SortBackwards -> (_ { sortBackwards = value })
      MenuOnTab     -> (_ { menuOnTab     = value })
      WebsitesOnlyIfNoAudible -> (_ { websitesOnlyIfNoAudible = value })
      DomainEnabled index ->
        _markAsAudible <<< ix index %~ set _enabled value
      DomainWithSubdomains index ->
        _markAsAudible <<< ix index %~ set _withSubdomains value
      FollowNotifications ->
        _followNotifications .~ value
      NotificationsFirst ->
        _notificationsFirst .~ value
  saveSettings

saveSettings :: forall a i o. H.HalogenM State a i o Aff Unit
saveSettings = do
  settings <- H.gets $ view _settings
  let validationResult = validate settings :: Either ValidationResult ValidSettings
  case validationResult of
    Left errors -> do
      H.modify_ $ _validationResult .~ errors
    Right _ -> do
      H.modify_ $ _validationResult .~ goodValidationResult
  for_ validationResult \validSettings ->
    H.liftAff do
      FFI.save validSettings

validate :: Settings -> Either ValidationResult ValidSettings
validate settings =
  let
    websites = (settings ^. _markAsAudible) <#> view (_domain <<< to FFI.isValidDomain)
    websitesValid = and websites :: Boolean
    mbTimeout = do
      n <- Int.fromString settings.notificationsTimeout
      Alt.guard (n >= 0)
      pure n
    mbDuration = do
      n <- Int.fromString settings.maxNotificationDuration
      Alt.guard (n >= 0)
      pure n
  in
   case mbTimeout /\ mbDuration /\ websitesValid of
     Just timeout /\ Just duration /\ true ->
       Right
       { includeMuted: settings.includeMuted
       , allWindows: settings.allWindows
       , includeFirst: settings.includeFirst
       , sortBackwards: settings.sortBackwards
       , menuOnTab: settings.menuOnTab
       , markAsAudible: settings.markAsAudible
       , websitesOnlyIfNoAudible: settings.websitesOnlyIfNoAudible
       , followNotifications: settings.followNotifications
       , notificationsTimeout: timeout
       , maxNotificationDuration: duration
       , notificationsFirst: settings.notificationsFirst
       }
     _ ->
       Left
       { websites: websites
       , isValidTimeout: isJust mbTimeout
       , isValidDuration: isJust mbDuration
       }

modifySettings :: forall a i o. (Settings -> Settings) -> H.HalogenM State a i o Aff Unit
modifySettings = H.modify_ <<< over _settings

setPageState :: forall a i o. PageState -> H.HalogenM State a i o Aff Unit
setPageState = H.modify_ <<< set _pageState

cancelRestoreRef = wrap "cancel-restore"

_settings = prop (SProxy :: SProxy "settings")
_pageState = prop (SProxy :: SProxy "pageState")
_withSubdomains = prop (SProxy :: SProxy "withSubdomains")
_domain = prop (SProxy :: SProxy "domain")
_enabled = prop (SProxy :: SProxy "enabled")
_markAsAudible = prop (SProxy :: SProxy "markAsAudible")
_validationResult = prop (SProxy :: SProxy "validationResult")
_notificationsTimeout = prop (SProxy :: SProxy "notificationsTimeout")
_followNotifications = prop (SProxy :: SProxy "followNotifications")
_maxNotificationDuration = prop (SProxy :: SProxy "maxNotificationDuration")
_notificationsFirst = prop (SProxy :: SProxy "notificationsFirst")
