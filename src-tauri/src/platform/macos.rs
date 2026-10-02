use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct MacosConfig {
    pub notes_on_all_spaces: bool,
    pub capsules_on_all_spaces: bool,
}
impl Default for MacosConfig {
    fn default() -> Self {
        Self {
            notes_on_all_spaces: true,
            capsules_on_all_spaces: true,
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn old_configs_default_to_cross_spaces_and_switches_round_trip() {
        let defaults: MacosConfig = serde_json::from_str("{}").unwrap();
        assert_eq!(defaults, MacosConfig::default());
        let config = MacosConfig {
            notes_on_all_spaces: false,
            capsules_on_all_spaces: true,
        };
        assert_eq!(
            serde_json::from_value::<MacosConfig>(serde_json::to_value(&config).unwrap()).unwrap(),
            config
        );
    }
}
