use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MaterialEffect {
    #[default]
    LiquidGlass,
    Frosted,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CapsuleDynamics {
    #[default]
    Lightweight,
    Elastic,
    Fluid,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct MaterialOpacity {
    pub glass: u8,
    pub frosted: u8,
}
impl Default for MaterialOpacity {
    fn default() -> Self {
        Self {
            glass: 35,
            frosted: 70,
        }
    }
}
impl MaterialOpacity {
    pub fn value(self, glass: bool) -> f64 {
        f64::from(if glass { self.glass } else { self.frosted }.min(100)) / 100.0
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct MacosConfig {
    pub material_effect: MaterialEffect,
    pub material_enabled: bool,
    pub main_opacity: MaterialOpacity,
    pub note_opacity: MaterialOpacity,
    pub capsule_opacity: MaterialOpacity,
    pub capsule_liquid_motion: bool,
    pub capsule_dynamics: CapsuleDynamics,
    pub note_dynamics: CapsuleDynamics,
    pub notes_on_all_spaces: bool,
    pub capsules_on_all_spaces: bool,
}
impl Default for MacosConfig {
    fn default() -> Self {
        Self {
            material_effect: MaterialEffect::LiquidGlass,
            material_enabled: true,
            main_opacity: MaterialOpacity::default(),
            note_opacity: MaterialOpacity::default(),
            capsule_opacity: MaterialOpacity {
                glass: 25,
                frosted: 60,
            },
            capsule_liquid_motion: true,
            capsule_dynamics: CapsuleDynamics::Lightweight,
            note_dynamics: CapsuleDynamics::Lightweight,
            notes_on_all_spaces: true,
            capsules_on_all_spaces: true,
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn opacity_extremes_and_legacy_settings_are_safe() {
        let config: MacosConfig =
            serde_json::from_str(r#"{"materialEffect":"frosted","notesOnAllSpaces":false}"#)
                .unwrap();
        assert_eq!(config.main_opacity, MaterialOpacity::default());
        assert!(!config.notes_on_all_spaces);
        assert_eq!(
            MaterialOpacity {
                glass: 0,
                frosted: 255
            }
            .value(true),
            0.0
        );
        assert_eq!(
            MaterialOpacity {
                glass: 0,
                frosted: 255
            }
            .value(false),
            1.0
        );
    }
    #[test]
    fn old_configs_default_to_cross_spaces_and_switches_round_trip() {
        let defaults: MacosConfig = serde_json::from_str("{}").unwrap();
        assert_eq!(defaults, MacosConfig::default());
        assert_eq!(defaults.capsule_dynamics, CapsuleDynamics::Lightweight);
        assert_eq!(defaults.note_dynamics, CapsuleDynamics::Lightweight);
        let config = MacosConfig {
            notes_on_all_spaces: false,
            capsules_on_all_spaces: true,
            material_effect: MaterialEffect::Frosted,
            material_enabled: false,
            capsule_dynamics: CapsuleDynamics::Fluid,
            note_dynamics: CapsuleDynamics::Elastic,
            ..Default::default()
        };
        assert_eq!(
            serde_json::from_value::<MacosConfig>(serde_json::to_value(&config).unwrap()).unwrap(),
            config
        );
    }
}
