/** TRD §6.4 UserSettings：用户设置 */
export interface UserSettings {
  fontScale: number;
  voiceEnabled: boolean;
  voiceRate: number;
  highContrast: boolean;
  preferredHintLevel: number;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  fontScale: 1,
  voiceEnabled: true,
  voiceRate: 1,
  highContrast: false,
  preferredHintLevel: 1,
};
