import { Component, type ErrorInfo, type PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { withTranslation, type WithTranslation } from 'react-i18next';

import { createLogger } from '@/lib/logger/logger';

const logger = createLogger('error-boundary');

interface State {
  error: Error | null;
}

class ErrorBoundaryBase extends Component<PropsWithChildren<WithTranslation>, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Never log arbitrary component props/state here — only the error
    // itself and the component stack, to avoid leaking private task/event
    // content into logs (see docs/SECURITY_AND_PRIVACY.md).
    logger.error(error.message, { componentStack: info.componentStack });
  }

  private reset = (): void => this.setState({ error: null });

  render() {
    const { error } = this.state;
    const { t, children } = this.props;

    if (error) {
      return (
        <View style={styles.container}>
          <Text variant="titleMedium" style={styles.title}>
            {t('errors:boundary.title')}
          </Text>
          <Text variant="bodyMedium" style={styles.description}>
            {t('errors:boundary.description')}
          </Text>
          <Button mode="contained" onPress={this.reset} style={styles.action}>
            {t('errors:boundary.retry')}
          </Button>
        </View>
      );
    }

    return children;
  }
}

export const ErrorBoundary = withTranslation()(ErrorBoundaryBase);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    marginBottom: 4,
    textAlign: 'center',
  },
  description: {
    textAlign: 'center',
    marginBottom: 16,
  },
  action: {
    marginTop: 8,
  },
});
