/**
 * snmp adapter - the setup wizard of the device tab
 *
 * Walks through the three steps a new device needs: the device itself, its MIB files, and the oids
 * it should read. At the end it writes one row into `devs` and one row per picked oid into `oids` -
 * exactly what one would otherwise enter by hand on the two tabs.
 *
 * The live read of step 3 works before the device has ever been saved: the whole device row is sent
 * with the request, so the instance does not have to know it yet. It reads one level at a time, the
 * content of a folder is fetched when the folder is opened.
 */

import React from 'react';

import {
    Alert,
    Box,
    Button,
    Checkbox,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControlLabel,
    IconButton,
    MenuItem,
    Step,
    StepLabel,
    Stepper,
    TextField,
    Tooltip,
} from '@mui/material';
import { Add as AddIcon, Refresh as RefreshIcon } from '@mui/icons-material';

// important to import from the package and not from one of its children
import { ConfigGeneric, type ConfigGenericProps, type ConfigGenericState } from '@iobroker/json-config';
import { I18n } from '@iobroker/gui-components';

import MibTree from './MibTree';

import {
    buildDeviceRow,
    buildOidRow,
    DEFAULT_WIZARD_DEVICE,
    deviceIssues,
    filterTree,
    findNode,
    insertChildren,
    pickNodes,
    type DeviceRow,
    type MibModuleInfo,
    type MibModulesResponse,
    type MibNodesResponse,
    type MibTreeNode,
    type OidRow,
    type WizardDevice,
} from './types';

/** the steps of the wizard */
const STEPS = ['snmp_wiz_stepDevice', 'snmp_wiz_stepMib', 'snmp_wiz_stepOids'];

/** snmp v3 uses an authorization set instead of a community */
const SNMP_V3 = 3;

interface SetupWizardState extends ConfigGenericState {
    open: boolean;
    /** index into STEPS */
    step: number;
    device: WizardDevice;
    /** all MIB modules the adapter has loaded */
    modules: MibModuleInfo[];
    /** names of the MIB files uploaded in this run */
    uploaded: string[];
    /** oid to start the live read at */
    walkOid: string;
    nodes: MibTreeNode[];
    expanded: string[];
    filter: string;
    /** oids the user has ticked */
    selected: string[];
    busy: boolean;
    requestError: string;
    /** true if the last live read has been cut off at the limit */
    truncated: boolean;
    /** oids whose children are currently being read from the device */
    loading: string[];
    /** name of the device the last run created, for the closing hint */
    created: string;
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
    /** a row which contains a field with a helper text - those are aligned by their top edge */
    controlsWithHelp: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        alignItems: 'flex-start',
        marginBottom: 8,
    },
    field: {
        width: 240,
    },
    /** the filter uses the width the rest of its row leaves over */
    filter: {
        flex: '1 1 220px',
        maxWidth: 420,
    },
    step: {
        minHeight: 320,
    },
};

export default class SetupWizard extends ConfigGeneric<ConfigGenericProps, SetupWizardState> {
    public constructor(props: ConfigGenericProps) {
        super(props);

        this.state = {
            ...this.state,
            open: false,
            step: 0,
            device: { ...DEFAULT_WIZARD_DEVICE },
            modules: [],
            uploaded: [],
            walkOid: '1.3.6.1.2.1',
            nodes: [],
            expanded: [],
            filter: '',
            selected: [],
            busy: false,
            requestError: '',
            truncated: false,
            loading: [],
            created: '',
        };
    }

    /** the current content of the device table */
    private get deviceRows(): DeviceRow[] {
        const rows = ConfigGeneric.getValue(this.props.data, 'devs') as DeviceRow[] | undefined;
        return Array.isArray(rows) ? rows : [];
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
            if ((response as { error?: string }).error) {
                this.setState({ requestError: (response as { error: string }).error });
            }
            return response as T;
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

        this.setState({ modules: response.modules });
    }

    /**
     * uploadMibs - store the selected MIB files and let the adapter parse them
     *
     * The files go into the same place the file selector of the MIB tab uses, so both ways end up
     * with the same set of files.
     *
     * @param files what the user picked in the file dialog
     */
    private async uploadMibs(files: FileList | null): Promise<void> {
        if (!files?.length) {
            return;
        }

        const uploaded: string[] = [];
        this.setState({ busy: true, requestError: '' });

        try {
            for (const file of Array.from(files)) {
                const data = await file.arrayBuffer();
                await this.props.oContext.socket.writeFile64(`${this.instance}.mibs`, file.name, data);
                uploaded.push(file.name);
            }
        } catch (e) {
            this.setState({ requestError: (e as Error).message || String(e) });
        } finally {
            this.setState({ busy: false });
        }

        this.setState({ uploaded: [...this.state.uploaded, ...uploaded] });
        if (uploaded.length) {
            await this.loadModules(true);
        }
    }

    /** walk - read the first level of the device of step 1, before it is even saved */
    private async walk(): Promise<void> {
        const response = await this.request<MibNodesResponse>('mibChildren', {
            dev: buildDeviceRow(this.state.device),
            oid: this.state.walkOid,
        });
        if (!response) {
            return;
        }

        this.setState({ nodes: response.nodes || [], truncated: !!response.truncated, expanded: [] });
    }

    /**
     * loadChildren - read the content of one folder from the device
     *
     * @param oid oid of the folder
     */
    private async loadChildren(oid: string): Promise<void> {
        this.setState({ loading: [...this.state.loading, oid] });

        try {
            const response = await this.request<MibNodesResponse>('mibChildren', {
                dev: buildDeviceRow(this.state.device),
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
     * select - tick or untick one node
     *
     * @param oid oid of the node
     */
    private select(oid: string): void {
        const selected = this.state.selected.includes(oid)
            ? this.state.selected.filter(entry => entry !== oid)
            : [...this.state.selected, oid];
        this.setState({ selected });
    }

    /** open - start a new run */
    private open(): void {
        this.setState(
            {
                open: true,
                step: 0,
                device: { ...DEFAULT_WIZARD_DEVICE },
                uploaded: [],
                nodes: [],
                expanded: [],
                filter: '',
                selected: [],
                requestError: '',
                truncated: false,
                created: '',
            },
            () => void this.loadModules(false),
        );
    }

    /**
     * finish - create the device and the oids it should read
     *
     * Both tables are written the way the dialog itself writes them, so the result can be corrected
     * on the device and OID tabs afterwards. Nothing is saved here - that stays with the save button
     * of the dialog.
     */
    private async finish(): Promise<void> {
        const device = buildDeviceRow(this.state.device);
        const nodes = pickNodes(this.state.nodes, this.state.selected);

        await this.onChange('devs', [...this.deviceRows, device]);
        await this.onChange('oids', [
            ...this.oidRows,
            ...nodes.map(node => buildOidRow(node, device.devOidGroup, this.useMibNames)),
        ]);

        this.setState({ open: false, created: device.devName });
    }

    /** renderDevice - step 1: the device itself */
    private renderDevice(): React.JSX.Element {
        const device = this.state.device;
        const issues = deviceIssues(device, this.deviceRows);

        /**
         * change - update one attribute of the device
         *
         * @param values the attributes to change
         */
        const change = (values: Partial<WizardDevice>): void => this.setState({ device: { ...device, ...values } });

        return (
            <Box style={styles.step}>
                <div style={styles.controlsWithHelp}>
                    <TextField
                        size="small"
                        style={styles.field}
                        label={I18n.t('snmp_wiz_name')}
                        value={device.name}
                        error={
                            issues.includes('name') || issues.includes('nameInvalid') || issues.includes('duplicate')
                        }
                        helperText={I18n.t(
                            issues.includes('nameInvalid')
                                ? 'snmp_wiz_nameInvalid'
                                : issues.includes('duplicate')
                                  ? 'snmp_wiz_nameTaken'
                                  : 'snmp_wiz_nameHelp',
                        )}
                        onChange={e => change({ name: e.target.value })}
                    />

                    <TextField
                        size="small"
                        style={styles.field}
                        label={I18n.t('snmp_wiz_ip')}
                        value={device.ipAddr}
                        error={issues.includes('ip')}
                        helperText={I18n.t('snmp_wiz_ipHelp')}
                        onChange={e => change({ ipAddr: e.target.value })}
                    />

                    <FormControlLabel
                        style={{ marginTop: 4 }}
                        control={
                            <Checkbox
                                checked={device.ip6}
                                onChange={e => change({ ip6: e.target.checked })}
                            />
                        }
                        label={I18n.t('snmp_wiz_ip6')}
                    />
                </div>

                <div style={styles.controlsWithHelp}>
                    <TextField
                        select
                        size="small"
                        style={styles.field}
                        label={I18n.t('snmp_wiz_version')}
                        value={device.snmpVers}
                        onChange={e => change({ snmpVers: Number(e.target.value) })}
                    >
                        <MenuItem value={1}>SNMP v1</MenuItem>
                        <MenuItem value={2}>SNMP v2c</MenuItem>
                        <MenuItem value={3}>SNMP v3</MenuItem>
                    </TextField>

                    <TextField
                        size="small"
                        style={styles.field}
                        label={I18n.t(device.snmpVers === SNMP_V3 ? 'snmp_wiz_authId' : 'snmp_wiz_community')}
                        value={device.authId}
                        helperText={I18n.t(
                            device.snmpVers === SNMP_V3 ? 'snmp_wiz_authIdHelp' : 'snmp_wiz_communityHelp',
                        )}
                        onChange={e => change({ authId: e.target.value })}
                    />

                    <TextField
                        size="small"
                        style={styles.field}
                        label={I18n.t('snmp_wiz_group')}
                        value={device.group}
                        placeholder={device.name}
                        helperText={I18n.t('snmp_wiz_groupHelp')}
                        onChange={e => change({ group: e.target.value })}
                    />
                </div>
            </Box>
        );
    }

    /** renderMib - step 2: the MIB files, which are optional */
    private renderMib(): React.JSX.Element {
        const modules = this.state.modules.filter(module => !module.base);

        return (
            <Box style={styles.step}>
                <Alert
                    severity="info"
                    style={{ marginBottom: 8 }}
                >
                    {I18n.t('snmp_wiz_mibHelp')}
                </Alert>

                <div style={styles.controls}>
                    <Button
                        variant="outlined"
                        size="small"
                        component="label"
                        disabled={this.state.busy}
                    >
                        {I18n.t('snmp_wiz_upload')}
                        <input
                            type="file"
                            multiple
                            hidden
                            onChange={e => void this.uploadMibs(e.target.files)}
                        />
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

                    {this.state.uploaded.length ? (
                        <Chip
                            size="small"
                            label={I18n.t('snmp_wiz_uploaded', this.state.uploaded.length)}
                        />
                    ) : null}
                </div>

                <div style={styles.controls}>
                    {modules.length
                        ? I18n.t('snmp_wiz_modules', modules.map(module => module.name).join(', '))
                        : I18n.t('snmp_wiz_noModules')}
                </div>
            </Box>
        );
    }

    /** renderOids - step 3: pick the values the adapter should read */
    private renderOids(): React.JSX.Element {
        const nodes = filterTree(this.state.nodes, this.state.filter);

        return (
            <Box style={styles.step}>
                <div style={styles.controls}>
                    {/* a tooltip here would cover the open menu - the start OID shows what it does */}
                    <TextField
                        select
                        size="small"
                        style={styles.field}
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
                        style={styles.field}
                        label={I18n.t('snmp_mib_walkOid')}
                        value={this.state.walkOid}
                        onChange={e => this.setState({ walkOid: e.target.value })}
                    />

                    <Button
                        variant="contained"
                        size="small"
                        disabled={this.state.busy}
                        onClick={() => void this.walk()}
                    >
                        {I18n.t('snmp_mib_walk')}
                    </Button>

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

                    <Chip
                        size="small"
                        label={I18n.t('snmp_wiz_selected', this.state.selected.length)}
                    />
                </div>

                {this.state.truncated ? (
                    <Alert
                        severity="info"
                        style={{ marginBottom: 8 }}
                    >
                        {I18n.t('snmp_mib_truncated')}
                    </Alert>
                ) : null}

                <MibTree
                    nodes={nodes}
                    expanded={this.state.expanded}
                    onToggle={oid => this.toggle(oid)}
                    renderAction={node =>
                        node.readable ? (
                            <Checkbox
                                size="small"
                                checked={this.state.selected.includes(node.oid)}
                                onChange={() => this.select(node.oid)}
                            />
                        ) : null
                    }
                    emptyText={I18n.t(this.state.busy ? 'snmp_mib_loading' : 'snmp_mib_empty')}
                    loading={this.state.loading}
                    maxHeight={320}
                />
            </Box>
        );
    }

    public renderItem(): React.JSX.Element {
        const blocked = this.state.step === 0 && !!deviceIssues(this.state.device, this.deviceRows).length;

        return (
            <Box style={{ width: '100%' }}>
                <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={() => this.open()}
                >
                    {I18n.t('snmp_wiz_button')}
                </Button>

                {this.state.created ? (
                    <Alert
                        severity="success"
                        style={{ marginTop: 8 }}
                    >
                        {I18n.t('snmp_wiz_created', this.state.created)}
                    </Alert>
                ) : null}

                <Dialog
                    open={this.state.open}
                    maxWidth="lg"
                    fullWidth
                    onClose={() => this.setState({ open: false })}
                >
                    <DialogTitle>{I18n.t('snmp_wiz_title')}</DialogTitle>

                    <DialogContent>
                        <Stepper
                            activeStep={this.state.step}
                            style={{ marginBottom: 16 }}
                        >
                            {STEPS.map(step => (
                                <Step key={step}>
                                    <StepLabel>{I18n.t(step)}</StepLabel>
                                </Step>
                            ))}
                        </Stepper>

                        {this.state.requestError ? (
                            <Alert
                                severity="error"
                                style={{ marginBottom: 8 }}
                            >
                                {this.state.requestError}
                            </Alert>
                        ) : null}

                        {this.state.step === 0 ? this.renderDevice() : null}
                        {this.state.step === 1 ? this.renderMib() : null}
                        {this.state.step === 2 ? this.renderOids() : null}
                    </DialogContent>

                    <DialogActions>
                        <Button onClick={() => this.setState({ open: false })}>{I18n.t('snmp_wiz_cancel')}</Button>

                        <Button
                            disabled={!this.state.step}
                            onClick={() => this.setState({ step: this.state.step - 1 })}
                        >
                            {I18n.t('snmp_wiz_back')}
                        </Button>

                        {this.state.step < STEPS.length - 1 ? (
                            <Button
                                variant="contained"
                                disabled={blocked}
                                onClick={() => {
                                    const step = this.state.step + 1;
                                    this.setState({ step }, () => {
                                        // entering the oid step without a tree - show the selected module
                                        if (step === 2 && !this.state.nodes.length) {
                                            void this.walk();
                                        }
                                    });
                                }}
                            >
                                {I18n.t('snmp_wiz_next')}
                            </Button>
                        ) : (
                            <Button
                                variant="contained"
                                onClick={() => void this.finish()}
                            >
                                {I18n.t('snmp_wiz_finish')}
                            </Button>
                        )}
                    </DialogActions>
                </Dialog>
            </Box>
        );
    }
}
