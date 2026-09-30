/**
 * snmp adapter - the MIB browser of the config dialog
 *
 * One browser, one source: the device is read live, level by level, and the uploaded MIB files give
 * the values their names. The list of MIB modules is the way to jump to the root of a MIB.
 *
 * The component never touches the MIB files itself; it asks the running instance over `sendTo`.
 */

import React from 'react';

import {
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    IconButton,
    MenuItem,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import {
    Add as AddIcon,
    Check as CheckIcon,
    LibraryAdd as LibraryAddIcon,
    Refresh as RefreshIcon,
} from '@mui/icons-material';

// important to import from the package and not from one of its children
import { ConfigGeneric, type ConfigGenericProps, type ConfigGenericState } from '@iobroker/json-config';

import MibTree from './MibTree';
import { I18n } from '@iobroker/gui-components';

import {
    addableNodes,
    buildOidRow,
    deviceOptions,
    filterTree,
    findNode,
    insertChildren,
    isConfigured,
    suggestGroup,
    type DeviceRow,
    type MibModuleInfo,
    type MibModulesResponse,
    type MibNodesResponse,
    type MibTreeNode,
    type OidRow,
} from './types';
import { writeTable } from './configTable';

interface MibBrowserState extends ConfigGenericState {
    /** all MIB modules the adapter has loaded */
    modules: MibModuleInfo[];
    /** MIB files which could not be parsed, keyed by file name */
    fileErrors: Record<string, string>;
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
    /** true if the last read has been cut off at the limit */
    truncated: boolean;
    /** oids whose children are currently being read from the device */
    loading: string[];
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
    /**
     * a row which contains a field with a helper text
     *
     * Such a field is higher than the others, so the row is aligned by the top edge of the input
     * boxes - centering them would lift the field with the helper text out of the row.
     */
    controlsWithHelp: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        alignItems: 'flex-start',
        marginBottom: 8,
    },
    /**
     * a fixed width, not a minimum one
     *
     * A flex item is as wide as its content, so a field with a helper text would grow to the width
     * of that text and would no longer line up with the field above it.
     */
    select: {
        width: 220,
    },
    /** the filter uses the width the rest of its row leaves over */
    filter: {
        flex: '1 1 220px',
        maxWidth: 420,
    },
    /** the counter beside the fields of a row which is aligned by its top edge */
    count: {
        marginTop: 7,
    },
};

export default class MibBrowser extends ConfigGeneric<ConfigGenericProps, MibBrowserState> {
    public constructor(props: ConfigGenericProps) {
        super(props);

        this.state = {
            ...this.state,
            modules: [],
            fileErrors: {},
            selectedDevice: '',
            walkOid: '1.3.6.1.2.1',
            nodes: [],
            expanded: [],
            filter: '',
            group: '',
            busy: false,
            requestError: '',
            truncated: false,
            loading: [],
        };
    }

    public async componentDidMount(): Promise<void> {
        await super.componentDidMount();

        // the first device is preselected, its oid group is what the add buttons fill
        const device = deviceOptions(this.deviceRows)[0];
        this.setState({
            selectedDevice: device?.value || '',
            group: device?.group || suggestGroup(this.oidRows),
        });

        await this.loadModules(false);
    }

    /**
     * componentDidUpdate - pick up a device which has been created while the browser was open
     *
     * The device table is edited on another tab, so the browser can be mounted before the first
     * device exists. `ConfigGeneric` has no `componentDidUpdate`, so nothing has to be chained.
     */
    public componentDidUpdate(): void {
        if (this.state.selectedDevice) {
            return;
        }

        const device = deviceOptions(this.deviceRows)[0];
        if (device) {
            this.setState({ selectedDevice: device.value, group: device.group || this.state.group });
        }
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

        this.setState({ modules: response.modules, fileErrors: response.errors || {} });
    }

    /**
     * selectDevice - pick the device the oids are collected for
     *
     * The device decides both which oid group is filled and, in device mode, which device is read,
     * so that one never has to know the name of the group.
     *
     * @param name name of the device
     */
    private selectDevice(name: string): void {
        const device = deviceOptions(this.deviceRows).find(entry => entry.value === name);

        this.setState({
            selectedDevice: name,
            // a device without a group keeps whatever is currently entered
            group: device?.group || this.state.group,
            requestError: '',
        });
    }

    /** walk - read the selected device live */
    private async walk(): Promise<void> {
        const response = await this.request<MibNodesResponse>('mibChildren', {
            device: this.state.selectedDevice,
            oid: this.state.walkOid,
        });
        if (!response) {
            return;
        }

        this.setState({
            nodes: response.nodes || [],
            truncated: !!response.truncated,
            expanded: [],
        });
    }

    /**
     * loadChildren - read the content of one folder from the device
     *
     * Only the level which is opened is read, so that a big subtree does not have to be walked as a
     * whole - and so that the browser can be used on a device with thousands of values.
     *
     * @param oid oid of the folder
     */
    private async loadChildren(oid: string): Promise<void> {
        this.setState({ loading: [...this.state.loading, oid] });

        try {
            const response = await this.request<MibNodesResponse>('mibChildren', {
                device: this.state.selectedDevice,
                oid,
            });
            if (!response) {
                return;
            }

            this.setState({
                nodes: insertChildren(this.state.nodes, oid, response.nodes || []),
                truncated: this.state.truncated || !!response.truncated,
            });
        } finally {
            this.setState({ loading: this.state.loading.filter(entry => entry !== oid) });
        }
    }

    /**
     * changeGroup - change the oid group the selected device reads
     *
     * @param group name of the oid group
     */
    private changeGroup(group: string): void {
        this.setState({ group });
        void this.attachGroup(group.trim());
    }

    /**
     * attachGroup - let the selected device read the given oid group
     *
     * The group is an attribute of the device, so it is written back into the device table - without
     * that, the oids would end up in a group the device does not read at all.
     *
     * @param group name of the oid group
     */
    private async attachGroup(group: string): Promise<void> {
        const name = this.state.selectedDevice;
        const rows = this.deviceRows;

        if (!name || !rows.some(row => row?.devName === name && row.devOidGroup !== group)) {
            return;
        }

        await writeTable(
            this,
            'devs',
            rows.map(row => (row?.devName === name ? { ...row, devOidGroup: group } : row)),
        );
    }

    /**
     * addOids - append nodes of the tree to the OID table
     *
     * @param nodes the nodes to add - already filtered, everything given here becomes a row
     */
    private async addOids(nodes: MibTreeNode[]): Promise<void> {
        const group = this.state.group.trim();
        if (!group) {
            this.setState({ requestError: I18n.t('snmp_mib_groupRequired') });
            return;
        }
        if (!nodes.length) {
            return;
        }

        const rows = [...this.oidRows, ...nodes.map(node => buildOidRow(node, group, this.useMibNames))];
        this.setState({ requestError: '' });

        // a device created before this version may still carry an empty group
        await this.attachGroup(group);
        await writeTable(this, 'oids', rows);
    }

    /**
     * toggle - expand or collapse one node
     *
     * @param oid oid of the node
     */
    private toggle(oid: string): void {
        if (this.state.expanded.includes(oid)) {
            this.setState({ expanded: this.state.expanded.filter(entry => entry !== oid) });
            return;
        }

        this.setState({ expanded: [...this.state.expanded, oid] });

        // a folder is filled when it is opened for the first time
        const node = findNode(this.state.nodes, oid);
        if (node?.hasChildren && !node.children) {
            void this.loadChildren(oid);
        }
    }

    /**
     * renderAdd - the button which adds one node of the tree to the OID table
     *
     * @param node node of the MIB tree
     * @returns the button, or null for a node which carries no value
     */
    private renderAdd(node: MibTreeNode): React.JSX.Element | null {
        if (!node.readable) {
            // a folder carries no value itself, but everything below it can be taken over at once
            return node.children?.length || node.hasChildren ? this.renderAddSubtree(node) : null;
        }

        const isAdded = isConfigured(node, this.oidRows, this.state.group.trim(), this.useMibNames);
        // a column of a table addresses no value of its own, the index of a row is missing
        const needsIndex = !!node.column && !node.instance;

        return (
            <Tooltip
                title={I18n.t(
                    isAdded ? 'snmp_mib_addedTooltip' : needsIndex ? 'snmp_mib_columnTooltip' : 'snmp_mib_addTooltip',
                )}
            >
                {/* a disabled button does not fire the events the tooltip listens to */}
                <span>
                    <IconButton
                        size="small"
                        color={isAdded ? 'success' : needsIndex ? 'warning' : 'primary'}
                        disabled={isAdded}
                        onClick={() => void this.addOids([node])}
                    >
                        {isAdded ? <CheckIcon fontSize="inherit" /> : <AddIcon fontSize="inherit" />}
                    </IconButton>
                </span>
            </Tooltip>
        );
    }

    /**
     * renderAddSubtree - the button which takes over every value below one folder
     *
     * @param node folder of the MIB tree
     * @returns the button
     */
    private renderAddSubtree(node: MibTreeNode): React.JSX.Element {
        const busy = this.state.loading.includes(node.oid);

        return (
            <Tooltip title={I18n.t('snmp_mib_addSubtreeTooltip')}>
                {/* a disabled button does not fire the events the tooltip listens to */}
                <span>
                    <IconButton
                        size="small"
                        disabled={busy}
                        onClick={() => void this.addSubtree(node.oid)}
                    >
                        {busy ? <CircularProgress size={14} /> : <LibraryAddIcon fontSize="inherit" />}
                    </IconButton>
                </span>
            </Tooltip>
        );
    }

    /**
     * addSubtree - take over every value below one node
     *
     * The values are read in one walk: the user asked for the whole subtree, so there is nothing to
     * save by reading it level by level. Values the group already contains are left out.
     *
     * @param oid oid of the folder
     */
    private async addSubtree(oid: string): Promise<void> {
        this.setState({ loading: [...this.state.loading, oid] });

        try {
            const response = await this.request<MibNodesResponse>('mibSubtree', {
                device: this.state.selectedDevice,
                oid,
            });
            if (!response) {
                return;
            }

            const group = this.state.group.trim();
            const nodes = (response.nodes || []).filter(
                node => !isConfigured(node, this.oidRows, group, this.useMibNames),
            );

            this.setState({ truncated: this.state.truncated || !!response.truncated });
            await this.addOids(nodes);
        } finally {
            this.setState({ loading: this.state.loading.filter(entry => entry !== oid) });
        }
    }

    /** renderControls - the target device, the source of the tree and the filter */
    private renderControls(): React.JSX.Element {
        const fileErrors = Object.entries(this.state.fileErrors);
        const devices = deviceOptions(this.deviceRows);
        const group = this.state.group.trim();
        const configured = this.oidRows.filter(row => row?.oidGroup === group).length;
        // everything the current filter shows and the group does not contain yet
        const addable = addableNodes(
            filterTree(this.state.nodes, this.state.filter),
            this.oidRows,
            group,
            this.useMibNames,
        );

        return (
            <>
                {/* the device is the target - everything picked below is added to its oid group */}
                <div style={styles.controlsWithHelp}>
                    {/* as a helper text the explanation wrapped over three lines */}
                    <Tooltip title={I18n.t('snmp_mib_deviceHelp')}>
                        <TextField
                            select
                            size="small"
                            style={styles.select}
                            label={I18n.t('snmp_mib_device')}
                            value={this.state.selectedDevice}
                            onChange={e => this.selectDevice(e.target.value)}
                            helperText={devices.length ? undefined : I18n.t('snmp_mib_noDevices')}
                        >
                            {devices.map(device => (
                                <MenuItem
                                    key={device.value}
                                    value={device.value}
                                >
                                    {device.label}
                                </MenuItem>
                            ))}
                        </TextField>
                    </Tooltip>

                    <TextField
                        size="small"
                        style={styles.select}
                        label={I18n.t('snmp_mib_group')}
                        value={this.state.group}
                        onChange={e => this.changeGroup(e.target.value)}
                        helperText={I18n.t('snmp_mib_groupHelp')}
                    />

                    {group ? (
                        <Chip
                            size="small"
                            style={styles.count}
                            label={I18n.t('snmp_mib_inGroup', configured)}
                        />
                    ) : null}
                </div>

                {/* where in the tree of the device the reading starts */}
                <div style={styles.controls}>
                    {/* a tooltip here would cover the open menu - the start OID shows what it does */}
                    <TextField
                        select
                        size="small"
                        style={styles.select}
                        label={I18n.t('snmp_mib_module')}
                        value={this.state.modules.find(module => module.oid === this.state.walkOid)?.name ?? ''}
                        onChange={e => {
                            const oid = this.state.modules.find(module => module.name === e.target.value)?.oid;
                            if (oid) {
                                this.setState({ walkOid: oid }, () => void this.walk());
                            }
                        }}
                    >
                        {!this.state.modules.some(module => !!module.oid) ? (
                            <MenuItem
                                value=""
                                disabled
                            >
                                {I18n.t('snmp_mib_moduleNone')}
                            </MenuItem>
                        ) : null}
                        {this.state.modules
                            .filter(module => !!module.oid)
                            .map(module => (
                                <MenuItem
                                    key={module.name}
                                    value={module.name}
                                >
                                    {module.base ? `${module.name} (${I18n.t('snmp_mib_builtIn')})` : module.name}
                                    {` · ${module.symbols}`}
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

                    <Tooltip title={I18n.t('snmp_mib_reloadTooltip')}>
                        <span>
                            <IconButton
                                size="small"
                                disabled={this.state.busy}
                                onClick={() => void this.loadModules(true)}
                            >
                                <RefreshIcon fontSize="inherit" />
                            </IconButton>
                        </span>
                    </Tooltip>

                    {this.state.busy ? <CircularProgress size={18} /> : null}
                </div>

                <div style={styles.controls}>
                    <TextField
                        size="small"
                        style={styles.filter}
                        label={I18n.t('snmp_mib_filter')}
                        value={this.state.filter}
                        onChange={e => this.setState({ filter: e.target.value })}
                    />

                    <Tooltip title={I18n.t('snmp_mib_addAllTooltip')}>
                        {/* a disabled button does not fire the events the tooltip listens to */}
                        <span>
                            <Button
                                variant="outlined"
                                size="small"
                                startIcon={<AddIcon />}
                                disabled={!addable.length}
                                onClick={() => void this.addOids(addable)}
                            >
                                {I18n.t('snmp_mib_addAll', addable.length)}
                            </Button>
                        </span>
                    </Tooltip>
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

                <MibTree
                    nodes={nodes}
                    expanded={this.state.expanded}
                    onToggle={oid => this.toggle(oid)}
                    renderAction={node => this.renderAdd(node)}
                    emptyText={I18n.t(this.state.busy ? 'snmp_mib_loading' : 'snmp_mib_empty')}
                    loading={this.state.loading}
                />
            </Box>
        );
    }
}
