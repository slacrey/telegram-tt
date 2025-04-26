import { createStore, get, set } from 'idb-keyval';

// Initialize the store
createStore('forward-config', 'store');

export interface ForwardConfig {
  rules: Record<string, string[]>;
  filters: Record<string, string[]>;
  includes: Record<string, string[]>;
}

// Helper function to load config
export async function loadTargetUserConfig(): Promise<ForwardConfig> {
  try {
    const config = await get<ForwardConfig>('rule_target_group_config');
    return config || { rules: {},filters:{},includes:{} };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Error loading target user config:', error);
    return { rules: {},filters:{},includes:{} };
  }
}

// Helper function to save config
export async function saveTargetUserConfig(config: ForwardConfig) {
  try {
    await set('rule_target_group_config', config);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Error saving target user config:', error);
  }
}

// Helper function to load source user config
export async function loadSourceUserConfig(): Promise<ForwardConfig> {
  try {
    const config = await get<ForwardConfig>('rule_source_group_config');
    return config || { rules: {},filters:{},includes:{} };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Error loading source user config:', error);
    return { rules: {},filters:{},includes:{} };
  }
}

// Helper function to save config
export async function saveSourceUserConfig(config: ForwardConfig) {
  try {
    await set('rule_source_group_config', config);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Error saving source user config:', error);
  }
}
