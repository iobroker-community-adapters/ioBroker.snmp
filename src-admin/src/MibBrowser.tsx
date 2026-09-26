import React from 'react';

import {
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    IconButton,
    MenuItem,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import {
    Add as AddIcon,
    ChevronRight as ChevronRightIcon,
    ExpandMore as ExpandMoreIcon,
    Refresh as RefreshIcon,
} from '@mui/icons-material';

// important to import from the package and not from one of its children
import { ConfigGeneric, type ConfigGenericProps, type ConfigGenericState } from '@iobroker/json-config';
import { I18n } from '@iobroker/gui-components';

import {
    buildOidRow,
    collectOids,
    filterTree,
    suggestGroup,
    type MibDevicesResponse,
    type MibModuleInfo,
    type MibModulesResponse,
    type MibNodesResponse,
    type MibTreeNode,
    type OidRow,
} from './types';

type Mode = 'mib' | 'device';

interface MibBrowserState extends ConfigGenericState {
    /** all MIB modules the adapter has loaded */
    modules: MibModuleInfo[];
    /** MIB files which could not be parsed, keyed by file name */
    fileErrors: Record<string, string>;
    /** devices which can be walked */
    devices: { value: string; label: string }[];
    /** whether the tree comes from a MIB file or from a live walk */
    mode: Mode;
    selectedModule: string;
    selectedDevice: string;
    /** oid to walk, only used in device mode */
    walkOid: string;
    /** the tree currently displayed */
    nodes: MibTreeNode[];
    /** oids of the expanded nodes */
    expanded: string[];
    filter: string;
    /** OID group new rows are added to */
    group: string;
    busy: boolean;
    /** error of the last request */
    requestError: string;
    /** true if the last walk has been cut off at the limit */
    truncated: boolean;
    /** oids added to the OID table during this session, for the visual feedback */
    added: string[];
}

const styles: Record<string, React.CSSProperties> = {
    controls: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        alignItems: 'center',
        marginBottom: 8,
    },
    select: {
        minWidth: 220,
    },
    tree: {
        maxHeight: 420,
        overflow: 'auto',
    },
    oid: {
        fontFamily: 'monospace',
        fontSize: '0.8rem',
        whiteSpace: 'nowrap',
    },
    value: {
        fontFamily: 'monospace',
        fontSize: '0.8rem',
        maxWidth: 260,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    nameCell: {
        whiteSpace: 'nowrap',
    },
};

export default class MibBrowser extends ConfigGeneric<ConfigGenericProps, MibBrowserState> {
    public constructor(props: ConfigGenericProps) {
        super(props);

        this.state = {
            ...this.state,
            modules: [],
            fileErrors: {},
            devices: [],
            mode: 'mib',
            selectedModule: '',
            selectedDevice: '',
            walkOid: '1.3.6.1.2.1',
            nodes: [],
            expanded: [],
            filter: '',
            group: '',
            busy: false,
            requestError: '',
            truncated: false,
            added: [],
        };
    }

    public async componentDidMount(): Promise<void> {
        await super.componentDidMount();
        this.setState({ group: suggestGroup(this.oidRows) });
        await this.loadModules(false);
        await this.loadDevices();
    }

    /** the current content of the OID table */
    private get oidRows(): OidRow[] {
        const rows = ConfigGeneric.getValue(this.props.data, 'oids') as OidRow[] | undefined;
        return Array.isArray(rows) ? rows : [];
    }

    /** true if the adapter stores symbolic oids and derives the object ids from the MIB */
    private get useMibNames(): boolean {
        return !!ConfigGeneric.getValue(this.props.data, 'optUseMibNames');
    }

    /** instance to send the requests to */
    private get instance(): string {
        return `${this.props.oContext.adapterName}.${this.props.oContext.instance}`;
    }

    /**
     * request - send one command to the running instance
     *
     * @param command name of the sendTo command
     * @param data payload of the command
     * @returns the response, or null if the instance did not answer
     */
    private async request<T>(command: string, data?: unknown): Promise<T | null> {
        if (!this.props.alive) {
            this.setState({ requestError: I18n.t('snmp_mib_instanceNotRunning') });
            return null;
        }

        this.setState({ busy: true, requestError: '' });
        try {
            const response = await this.props.oContext.socket.sendTo(this.instance, command, data ?? {});

            if (!response) {
                this.setState({ requestError: I18n.t('snmp_mib_noAnswer') });
                return null;
            }
            if (response.error) {
                this.setState({ requestError: response.error });
            }
            return response;
        } catch (e) {
            this.setState({ requestError: (e as Error).message || String(e) });
            return null;
        } finally {
            this.setState({ busy: false });
        }
    }

    /**
     * loadModules - read the list of loaded MIB modules
     *
     * @param reload true to make the adapter re-read the uploaded files first
     */
    private async loadModules(reload: boolean): Promise<void> {
        const response = await this.request<MibModulesResponse>(reload ? 'mibReload' : 'mibModules');
        if (!response?.modules) {
            return;
        }

        const modules = response.modules;
        const selected =
            modules.find(module => module.name === this.state.selectedModule)?.name ||
            modules.find(module => !module.base)?.name ||
            modules[0]?.name ||
            '';

        this.setState({ modules, fileErrors: response.errors || {}, selectedModule: selected }, () => {
            if (selected && this.state.mode === 'mib') {
                void this.loadNodes(selected);
            }
        });
    }

    /** loadDevices - read the devices which can be walked */
    private async loadDevices(): Promise<void> {
        const response = await this.request<MibDevicesResponse>('mibDevices');
        if (!response?.devices) {
            return;
        }
        this.setState({
            devices: response.devices,
            selectedDevice: this.state.selectedDevice || response.devices[0]?.value || '',
        });
    }

    /**
     * loadNodes - read the tree of one MIB module
     *
     * @param moduleName name of the module
     */
    private async loadNodes(moduleName: string): Promise<void> {
        const response = await this.request<MibNodesResponse>('mibNodes', { module: moduleName });
        const nodes = response?.nodes || [];
        this.setState({ nodes, truncated: false, expanded: collectOids(nodes).slice(0, 1) });
    }

    /** walk - read the selected device live */
    private async walk(): Promise<void> {
        const response = await this.request<MibNodesResponse>('mibWalk', {
            device: this.state.selectedDevice,
            oid: this.state.walkOid,
        });
        const nodes = response?.nodes || [];
        this.setState({
            nodes,
            truncated: !!response?.truncated,
            // a walk result is usually flat and shallow - open everything down to the values
            expanded: collectOids(nodes),
        });
    }

    /**
     * addOid - append one node of the tree to the OID table
     *
     * @param node the node the user picked
     */
    private addOid(node: MibTreeNode): void {
        const group = this.state.group.trim();
        if (!group) {
            this.setState({ requestError: I18n.t('snmp_mib_groupRequired') });
            return;
        }

        const rows = [...this.oidRows, buildOidRow(node, group, this.useMibNames)];
        this.setState({ added: [...this.state.added, node.oid], requestError: '' });
        void this.onChange('oids', rows);
    }

    /**
     * toggle - expand or collapse one node
     *
     * @param oid oid of the node
     */
    private toggle(oid: string): void {
        const expanded = this.state.expanded.includes(oid)
            ? this.state.expanded.filter(entry => entry !== oid)
            : [...this.state.expanded, oid];
        this.setState({ expanded });
    }

    /**
     * renderRows - render the tree as indented table rows
     *
     * @param nodes nodes of the current level
     * @param depth nesting depth, used for the indentation
     * @returns the rows of this level and of all expanded children
     */
    private renderRows(nodes: MibTreeNode[], depth: number): React.JSX.Element[] {
        const rows: React.JSX.Element[] = [];

        for (const node of nodes) {
            const hasChildren = !!node.children?.length;
            const isExpanded = this.state.expanded.includes(node.oid);
            const isAdded = this.state.added.includes(node.oid);
            const label = node.instance ? `${node.name}.${node.instance}` : node.name;

            rows.push(
                <TableRow
                    key={node.oid}
                    hover
                >
                    <TableCell style={{ ...styles.nameCell, paddingLeft: 8 + depth * 20 }}>
                        {hasChildren ? (
                            <IconButton
                                size="small"
                                onClick={() => this.toggle(node.oid)}
                                aria-label={isExpanded ? 'collapse' : 'expand'}
                            >
                                {isExpanded ? (
                                    <ExpandMoreIcon fontSize="inherit" />
                                ) : (
                                    <ChevronRightIcon fontSize="inherit" />
                                )}
                            </IconButton>
                        ) : (
                            <span style={{ display: 'inline-block', width: 30 }} />
                        )}
                        <Tooltip title={node.description || ''}>
                            <span style={{ fontWeight: node.readable ? 500 : 400 }}>{label}</span>
                        </Tooltip>
                        {node.writeable ? (
                            <Chip
                                size="small"
                                label={I18n.t('snmp_mib_writeable')}
                                style={{ marginLeft: 6 }}
                            />
                        ) : null}
                    </TableCell>
                    <TableCell style={styles.oid}>{node.oid}</TableCell>
                    <TableCell>{node.syntax || ''}</TableCell>
                    <TableCell>{node.access || ''}</TableCell>
                    <TableCell style={styles.value}>
                        <Tooltip title={node.value || ''}>
                            <span>{node.value ?? ''}</span>
                        </Tooltip>
                    </TableCell>
                    <TableCell>
                        {node.readable ? (
                            <Tooltip title={I18n.t('snmp_mib_addTooltip')}>
                                <IconButton
                                    size="small"
                                    color={isAdded ? 'success' : 'primary'}
                                    onClick={() => this.addOid(node)}
                                >
                                    <AddIcon fontSize="inherit" />
                                </IconButton>
                            </Tooltip>
                        ) : null}
                    </TableCell>
                </TableRow>,
            );

            if (hasChildren && isExpanded) {
                rows.push(...this.renderRows(node.children as MibTreeNode[], depth + 1));
            }
        }

        return rows;
    }

    /** renderControls - module / device selection and the filter */
    private renderControls(): React.JSX.Element {
        const fileErrors = Object.entries(this.state.fileErrors);

        return (
            <>
                <div style={styles.controls}>
                    <TextField
                        select
                        size="small"
                        style={styles.select}
                        label={I18n.t('snmp_mib_source')}
                        value={this.state.mode}
                        onChange={e => {
                            const mode = e.target.value as Mode;
                            this.setState({ mode, nodes: [], requestError: '', truncated: false }, () => {
                                if (mode === 'mib' && this.state.selectedModule) {
                                    void this.loadNodes(this.state.selectedModule);
                                }
                            });
                        }}
                    >
                        <MenuItem value="mib">{I18n.t('snmp_mib_sourceMib')}</MenuItem>
                        <MenuItem value="device">{I18n.t('snmp_mib_sourceDevice')}</MenuItem>
                    </TextField>

                    {this.state.mode === 'mib' ? (
                        <TextField
                            select
                            size="small"
                            style={styles.select}
                            label={I18n.t('snmp_mib_module')}
                            value={this.state.selectedModule}
                            onChange={e => {
                                const selectedModule = e.target.value;
                                this.setState({ selectedModule }, () => void this.loadNodes(selectedModule));
                            }}
                        >
                            {this.state.modules.map(module => (
                                <MenuItem
                                    key={module.name}
                                    value={module.name}
                                >
                                    {module.base ? `${module.name} (${I18n.t('snmp_mib_builtIn')})` : module.name}
                                    {` · ${module.symbols}`}
                                </MenuItem>
                            ))}
                        </TextField>
                    ) : (
                        <>
                            <TextField
                                select
                                size="small"
                                style={styles.select}
                                label={I18n.t('snmp_mib_device')}
                                value={this.state.selectedDevice}
                                onChange={e => this.setState({ selectedDevice: e.target.value })}
                            >
                                {this.state.devices.map(device => (
                                    <MenuItem
                                        key={device.value}
                                        value={device.value}
                                    >
                                        {device.label}
                                    </MenuItem>
                                ))}
                            </TextField>
                            <TextField
                                size="small"
                                style={styles.select}
                                label={I18n.t('snmp_mib_walkOid')}
                                value={this.state.walkOid}
                                onChange={e => this.setState({ walkOid: e.target.value })}
                            />
                            <Button
                                variant="contained"
                                size="small"
                                disabled={this.state.busy || !this.state.selectedDevice}
                                onClick={() => void this.walk()}
                            >
                                {I18n.t('snmp_mib_walk')}
                            </Button>
                        </>
                    )}

                    <Tooltip title={I18n.t('snmp_mib_reloadTooltip')}>
                        <IconButton
                            size="small"
                            disabled={this.state.busy}
                            onClick={() => void this.loadModules(true)}
                        >
                            <RefreshIcon fontSize="inherit" />
                        </IconButton>
                    </Tooltip>

                    {this.state.busy ? <CircularProgress size={18} /> : null}
                </div>

                <div style={styles.controls}>
                    <TextField
                        size="small"
                        style={styles.select}
                        label={I18n.t('snmp_mib_filter')}
                        value={this.state.filter}
                        onChange={e => this.setState({ filter: e.target.value })}
                    />
                    <TextField
                        size="small"
                        style={styles.select}
                        label={I18n.t('snmp_mib_group')}
                        value={this.state.group}
                        onChange={e => this.setState({ group: e.target.value })}
                        helperText={I18n.t('snmp_mib_groupHelp')}
                    />
                </div>

                {fileErrors.length ? (
                    <Alert
                        severity="warning"
                        style={{ marginBottom: 8 }}
                    >
                        {fileErrors.map(([file, error]) => (
                            <div key={file}>{`${file}: ${error}`}</div>
                        ))}
                    </Alert>
                ) : null}

                {this.state.requestError ? (
                    <Alert
                        severity="error"
                        style={{ marginBottom: 8 }}
                    >
                        {this.state.requestError}
                    </Alert>
                ) : null}

                {this.state.truncated ? (
                    <Alert
                        severity="info"
                        style={{ marginBottom: 8 }}
                    >
                        {I18n.t('snmp_mib_truncated')}
                    </Alert>
                ) : null}
            </>
        );
    }

    public renderItem(): React.JSX.Element {
        const nodes = filterTree(this.state.nodes, this.state.filter);

        return (
            <Box style={{ width: '100%' }}>
                <Typography
                    variant="subtitle1"
                    gutterBottom
                >
                    {I18n.t('snmp_mib_title')}
                </Typography>

                {this.renderControls()}

                <Paper
                    variant="outlined"
                    style={styles.tree}
                >
                    <Table
                        size="small"
                        stickyHeader
                    >
                        <TableHead>
                            <TableRow>
                                <TableCell>{I18n.t('snmp_mib_colName')}</TableCell>
                                <TableCell>{I18n.t('snmp_mib_colOid')}</TableCell>
                                <TableCell>{I18n.t('snmp_mib_colSyntax')}</TableCell>
                                <TableCell>{I18n.t('snmp_mib_colAccess')}</TableCell>
                                <TableCell>{I18n.t('snmp_mib_colValue')}</TableCell>
                                <TableCell>{I18n.t('snmp_mib_colAdd')}</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {nodes.length ? (
                                this.renderRows(nodes, 0)
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={6}>
                                        {this.state.busy ? I18n.t('snmp_mib_loading') : I18n.t('snmp_mib_empty')}
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </Paper>
            </Box>
        );
    }
}
