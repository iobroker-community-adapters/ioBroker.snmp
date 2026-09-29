// this file is used only for the standalone simulation (npm start) and not part of the end build
import React from 'react';
import { ThemeProvider, StyledEngineProvider } from '@mui/material/styles';

import { Box } from '@mui/material';

import {
    GenericApp,
    I18n,
    type IobTheme,
    Loader,
    type GenericAppProps,
    type GenericAppState,
} from '@iobroker/gui-components';

import MibBrowser from './MibBrowser';

import enLocal from './i18n/en.json';
import deLocal from './i18n/de.json';
import ruLocal from './i18n/ru.json';
import ptLocal from './i18n/pt.json';
import nlLocal from './i18n/nl.json';
import frLocal from './i18n/fr.json';
import itLocal from './i18n/it.json';
import esLocal from './i18n/es.json';
import plLocal from './i18n/pl.json';
import ukLocal from './i18n/uk.json';
import zhCNLocal from './i18n/zh-cn.json';

const styles: Record<string, any> = {
    app: (theme: IobTheme): React.CSSProperties => ({
        backgroundColor: theme.palette.background.default,
        color: theme.palette.text.primary,
        height: '100%',
    }),
    item: {
        padding: 20,
    },
};

interface AppState extends GenericAppState {
    data: Record<string, any>;
    originalData: Record<string, any>;
}

export default class App extends GenericApp<GenericAppProps, AppState> {
    public constructor(props: GenericAppProps) {
        const extendedProps = { ...props };
        super(props, extendedProps);

        const data = { oids: [], optUseMibNames: true, _mibBrowser: '' };

        this.state = {
            ...this.state,
            data,
            originalData: JSON.parse(JSON.stringify(data)),
            theme: this.createTheme(),
        };

        I18n.setTranslations({
            en: enLocal,
            de: deLocal,
            ru: ruLocal,
            pt: ptLocal,
            nl: nlLocal,
            fr: frLocal,
            it: itLocal,
            es: esLocal,
            pl: plLocal,
            uk: ukLocal,
            'zh-cn': zhCNLocal,
        });
        // @ts-expect-error userLanguage could exist
        I18n.setLanguage((navigator.language || navigator.userLanguage || 'en').substring(0, 2).toLowerCase());
    }

    public render(): React.JSX.Element {
        if (!this.state.loaded) {
            return (
                <StyledEngineProvider injectFirst>
                    <ThemeProvider theme={this.state.theme}>
                        <Loader themeType={this.state.themeType} />
                    </ThemeProvider>
                </StyledEngineProvider>
            );
        }

        return (
            <StyledEngineProvider injectFirst>
                <ThemeProvider theme={this.state.theme}>
                    <Box sx={styles.app}>
                        <div style={styles.item}>
                            <MibBrowser
                                oContext={{
                                    adapterName: 'snmp',
                                    socket: this.socket,
                                    instance: 0,
                                    themeType: this.state.theme.palette.mode,
                                    isFloatComma: true,
                                    dateFormat: '',
                                    forceUpdate: () => {},
                                    systemConfig: {} as ioBroker.SystemConfigCommon,
                                    theme: this.state.theme,
                                    _themeName: this.state.themeName,
                                    onCommandRunning: (): void => {},
                                }}
                                alive
                                changed={JSON.stringify(this.state.originalData) !== JSON.stringify(this.state.data)}
                                themeName={this.state.theme.palette.mode}
                                common={{} as ioBroker.InstanceCommon}
                                attr="_mibBrowser"
                                data={this.state.data}
                                originalData={this.state.originalData}
                                onError={() => {}}
                                schema={{
                                    url: 'custom/customComponents.js',
                                    i18n: true,
                                    name: 'SnmpComponentSet/Components/MibBrowser',
                                    type: 'custom',
                                }}
                                onChange={(attrOrData, val) => {
                                    if (typeof attrOrData === 'string') {
                                        this.setState({ data: { ...this.state.data, [attrOrData]: val } });
                                    } else {
                                        this.setState({ data: attrOrData as Record<string, any> });
                                    }
                                }}
                            />
                        </div>
                    </Box>
                </ThemeProvider>
            </StyledEngineProvider>
        );
    }
}
