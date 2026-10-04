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
    pub lightweight_mode: bool,
    pub material_effect: MaterialEffect,
    pub material_enabled: bool,
    pub main_opacity: MaterialOpacity,
    pub note_opacity: MaterialOpacity,
    pub capsule_opacity: MaterialOpacity,
    pub capsule_liquid_motion: bool,
    pub capsule_dynamics: CapsuleDynamics,
    pub note_dynamics: CapsuleDynamics,
    pub note_spring: Option<bool>,
    pub refraction_strength: u8,
    pub fluid_low_power: bool,
    pub notes_on_all_spaces: bool,
    pub capsules_on_all_spaces: bool,
}
impl Default for MacosConfig {
    fn default() -> Self {
        Self {
            lightweight_mode: false,
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
            note_spring: None,
            refraction_strength: 100,
            fluid_low_power: false,
            notes_on_all_spaces: true,
            capsules_on_all_spaces: true,
        }
    }
}
impl MacosConfig {
    pub fn note_spring_enabled(&self) -> bool {
        self.note_spring
            .unwrap_or(self.note_dynamics != CapsuleDynamics::Lightweight)
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
        assert!(!config.lightweight_mode);
        assert!(
            serde_json::from_str::<MacosConfig>(r#"{"lightweightMode":true}"#)
                .unwrap()
                .lightweight_mode
        );
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
        assert!(!defaults.note_spring_enabled());
        let legacy: MacosConfig = serde_json::from_str(r#"{"noteDynamics":"elastic"}"#).unwrap();
        assert!(legacy.note_spring_enabled());
        let disabled: MacosConfig = serde_json::from_str(r#"{"noteDynamics":"fluid","noteSpring":false,"fluidLowPower":true,"refractionStrength":40}"#).unwrap();
        assert!(!disabled.note_spring_enabled());
        assert!(disabled.fluid_low_power);
        assert_eq!(disabled.refraction_strength, 40);
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
