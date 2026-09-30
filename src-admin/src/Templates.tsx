/**
 * snmp adapter - templates of OID definitions
 *
 * A template is a set of OID definitions for a device or a device class. It can be imported into an
 * OID group, and a group which has been put together by hand or with the MIB browser can be
 * exported as one - that is what makes such a set shareable.
 *
 * The oid group itself is never part of a template: it belongs to the installation, not to the
 * device class, and is chosen again on import.
 */

import React from 'react';

import { Alert, Box, Button, Chip, MenuItem, TextField, Tooltip, Typography } from '@mui/material';
import { Download as DownloadIcon, Upload as UploadIcon } from '@mui/icons-material';

// important to import from the package and not from one of its children
import { ConfigGeneric, type ConfigGenericProps, type ConfigGenericState } from '@iobroker/json-config';
import { I18n } from '@iobroker/gui-components';

import {
    buildTemplate,
    importTemplate,
    oidGroups,
    parseTemplate,
    type DeviceRow,
    type OidRow,
    type OidTemplate,
} from './types';
import { writeTable } from './configTable';

/**
 * the admin serves the files of an adapter under /adapter/<name>/
 *
 * @param adapter
 */
const SHIPPED = (adapter: string): string => `/adapter/${adapter}/templates`;

interface TemplatesState extends ConfigGenericState {
    /** oid group the template is exported from resp. imported into */
    group: string;
    /** templates delivered with the adapter, keyed by file name */
    shipped: { file: string; template: OidTemplate }[];
    /** the template which is about to be imported */
    selected: OidTemplate | null;
    /** where the selected template came from, for the button text */
    source: string;
    /** true to drop the rows the group already has */
    replace: boolean;
    error: string;
    /** name of the group the last import went into, for the confirmation */
    imported: string;
}

const styles: Record<string, React.CSSProperties> = {
    /** a row of controls in which every field has the same height */
    controls: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        alignItems: 'center',
        marginBottom: 8,
    },
    select: {
        width: 260,
    },
};

export default class Templates extends ConfigGeneric<ConfigGenericProps, TemplatesState> {
    public constructor(props: ConfigGenericProps) {
        super(props);

        this.state = {
            ...this.state,
            group: '',
            shipped: [],
            selected: null,
            source: '',
            replace: false,
            error: '',
            imported: '',
        };
    }

    public async componentDidMount(): Promise<void> {
        await super.componentDidMount();

        this.setState({ group: this.groups[0] ?? '' });
        await this.loadShipped();
    }

    /** the current content of the OID table */
    private get oidRows(): OidRow[] {
        const rows = ConfigGeneric.getValue(this.props.data, 'oids') as OidRow[] | undefined;
        return Array.isArray(rows) ? rows : [];
    }

    /** the current content of the device table */
    private get deviceRows(): DeviceRow[] {
        const rows = ConfigGeneric.getValue(this.props.data, 'devs') as DeviceRow[] | undefined;
        return Array.isArray(rows) ? rows : [];
    }

    /** the oid groups of the configuration */
    private get groups(): string[] {
        return oidGroups(this.oidRows, this.deviceRows);
    }

    /**
     * loadShipped - read the templates which come with the adapter
     *
     * They are served from the admin directory of the adapter, so no request to the instance is
     * needed - the templates are static files.
     */
    private async loadShipped(): Promise<void> {
        try {
            const base = SHIPPED(this.props.oContext.adapterName);
            const index = (await (await fetch(`${base}/index.json`)).json()) as { templates?: string[] };
            const shipped: { file: string; template: OidTemplate }[] = [];

            for (const file of index.templates || []) {
                const answer = await fetch(`${base}/${file}`);
                const { template, error } = parseTemplate(await answer.text());
                if (template) {
                    shipped.push({ file, template });
                } else {
                    console.warn(`template ${file} cannot be used: ${error}`);
                }
            }

            this.setState({ shipped });
        } catch (e) {
            // the templates are a convenience - without them the import from a file still works
            console.warn(`cannot read the delivered templates: ${(e as Error).message}`);
        }
    }

    /** exportGroup - offer the oids of the selected group as a template file */
    private exportGroup(): void {
        const group = this.state.group.trim();
        const template = buildTemplate(this.oidRows, group, group);

        const url = URL.createObjectURL(
            new Blob([`${JSON.stringify(template, null, 4)}\n`], { type: 'application/json' }),
        );
        const link = document.createElement('a');
        link.href = url;
        link.download = `${group || 'oids'}.snmp-template.json`;
        link.click();
        URL.revokeObjectURL(url);
    }

    /**
     * readFile - take a template out of a file the user picked
     *
     * @param files what the user picked in the file dialog
     */
    private async readFile(files: FileList | null): Promise<void> {
        const file = files?.[0];
        if (!file) {
            return;
        }

        const { template, error } = parseTemplate(await file.text());
        if (!template) {
            this.setState({ selected: null, source: '', error: I18n.t(`snmp_tpl_err_${error}`) });
            return;
        }

        this.setState({ selected: template, source: file.name, error: '', imported: '' });
    }

    /** importSelected - write the oids of the selected template into the oid table */
    private async importSelected(): Promise<void> {
        const template = this.state.selected;
        const group = this.state.group.trim();
        if (!template || !group) {
            return;
        }

        await writeTable(this, 'oids', importTemplate(this.oidRows, template, group, this.state.replace));
        this.setState({ imported: group, error: '' });
    }

    public renderItem(): React.JSX.Element {
        const groups = this.groups;
        const group = this.state.group.trim();
        const inGroup = this.oidRows.filter(row => row?.oidGroup === group).length;
        const selected = this.state.selected;

        return (
            <Box style={{ width: '100%' }}>
                <Typography
                    variant="subtitle1"
                    gutterBottom
                >
                    {I18n.t('snmp_tpl_title')}
                </Typography>

                <div style={styles.controls}>
                    <TextField
                        select={!!groups.length}
                        size="small"
                        style={styles.select}
                        label={I18n.t('snmp_tpl_group')}
                        value={this.state.group}
                        onChange={e => this.setState({ group: e.target.value, imported: '' })}
                    >
                        {groups.map(name => (
                            <MenuItem
                                key={name}
                                value={name}
                            >
                                {name}
                            </MenuItem>
                        ))}
                    </TextField>

                    <Chip
                        size="small"
                        label={I18n.t('snmp_tpl_inGroup', inGroup)}
                    />

                    <Tooltip title={I18n.t('snmp_tpl_exportTooltip')}>
                        <span>
                            <Button
                                variant="outlined"
                                size="small"
                                startIcon={<DownloadIcon />}
                                disabled={!inGroup}
                                onClick={() => this.exportGroup()}
                            >
                                {I18n.t('snmp_tpl_export')}
                            </Button>
                        </span>
                    </Tooltip>
                </div>

                <div style={styles.controls}>
                    <TextField
                        select
                        size="small"
                        style={styles.select}
                        label={I18n.t('snmp_tpl_delivered')}
                        value={this.state.shipped.some(entry => entry.template === selected) ? this.state.source : ''}
                        onChange={e => {
                            const entry = this.state.shipped.find(candidate => candidate.file === e.target.value);
                            this.setState({
                                selected: entry?.template ?? null,
                                source: entry?.file ?? '',
                                error: '',
                                imported: '',
                            });
                        }}
                    >
                        {this.state.shipped.map(entry => (
                            <MenuItem
                                key={entry.file}
                                value={entry.file}
                            >
                                {`${entry.template.name} · ${entry.template.oids.length}`}
                            </MenuItem>
                        ))}
                    </TextField>

                    <Button
                        variant="outlined"
                        size="small"
                        component="label"
                        startIcon={<UploadIcon />}
                    >
                        {I18n.t('snmp_tpl_fromFile')}
                        <input
                            type="file"
                            accept=".json,application/json"
                            hidden
                            onChange={e => void this.readFile(e.target.files)}
                        />
                    </Button>

                    <Button
                        variant="contained"
                        size="small"
                        disabled={!selected || !group}
                        onClick={() => void this.importSelected()}
                    >
                        {I18n.t(this.state.replace ? 'snmp_tpl_importReplace' : 'snmp_tpl_import', group)}
                    </Button>

                    <Button
                        size="small"
                        onClick={() => this.setState({ replace: !this.state.replace })}
                    >
                        {I18n.t(this.state.replace ? 'snmp_tpl_modeReplace' : 'snmp_tpl_modeAdd')}
                    </Button>
                </div>

                {selected ? (
                    <Alert
                        severity="info"
                        style={{ marginBottom: 8 }}
                    >
                        {`${selected.name}${selected.deviceClass ? ` (${selected.deviceClass})` : ''} · ${I18n.t(
                            'snmp_tpl_inGroup',
                            selected.oids.length,
                        )}${selected.mib ? ` · ${selected.mib}` : ''}`}
                        {selected.description ? <div>{selected.description}</div> : null}
                    </Alert>
                ) : null}

                {this.state.error ? (
                    <Alert
                        severity="error"
                        style={{ marginBottom: 8 }}
                    >
                        {this.state.error}
                    </Alert>
                ) : null}

                {this.state.imported ? (
                    <Alert
                        severity="success"
                        style={{ marginBottom: 8 }}
                    >
                        {I18n.t('snmp_tpl_imported', this.state.imported)}
                    </Alert>
                ) : null}
            </Box>
        );
    }
}
