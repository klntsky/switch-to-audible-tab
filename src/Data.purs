module Data where

import Prelude

-- | Should be in sync with background.js
type ValidSettings =
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
  , notificationsTimeout :: Int
  , maxNotificationDuration :: Int
  , notificationsFirst :: Boolean
  }
