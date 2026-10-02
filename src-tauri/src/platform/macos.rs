use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MaterialEffect {
    #[default]
    LiquidGlass,
    Frosted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct MacosConfig {
    pub material_effect: MaterialEffect,
    pub material_enabled: bool,
    pub notes_on_all_spaces: bool,
    pub capsules_on_all_spaces: bool,
}
impl Default for MacosConfig {
    fn default() -> Self {
        Self {
            material_effect: MaterialEffect::LiquidGlass,
            material_enabled: true,
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
            material_effect: MaterialEffect::Frosted,
            material_enabled: false,
        };
        assert_eq!(
            serde_json::from_value::<MacosConfig>(serde_json::to_value(&config).unwrap()).unwrap(),
            config
        );
    }
}
