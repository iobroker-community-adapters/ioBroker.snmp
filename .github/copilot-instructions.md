# ioBroker Adapter Development with GitHub Copilot

**Version:** 0.4.0
**Template Source:** https://github.com/DrozmotiX/ioBroker-Copilot-Instructions

This file contains instructions and best practices for GitHub Copilot when working on ioBroker adapter development.

## Project Context

You are working on an ioBroker adapter. ioBroker is an integration platform for the Internet of Things, focused on building smart home and industrial IoT solutions. Adapters are plugins that connect ioBroker to external systems, devices, or services.

This specific adapter (ioBroker.snmp) enables SNMP (Simple Network Management Protocol) communication to poll OID (Object Identifier) values from network devices, UPS systems, switches, routers, and other SNMP-enabled devices.

## Adapter-Specific Context
- **Adapter Name**: snmp (ioBroker.snmp)
- **Primary Function**: SNMP OID polling for IoT devices and network infrastructure monitoring
- **Key Dependencies**: net-snmp library for SNMP protocol communication, @iobroker/adapter-core
- **Configuration Requirements**: Complex OID/device configuration via JSON config in admin interface
- **Target Devices**: Network equipment (switches, routers), UPS systems, printers, servers with SNMP agents
- **Protocol Versions**: Supports SNMP v1, v2c, and v3 with authentication
- **Data Types**: Handles various SNMP data types (integer, string, OID, timeticks, etc.)

## SNMP-Specific Development Patterns

When working with this adapter, consider these SNMP-specific patterns:

### OID Management
- OIDs are stored in configuration arrays with grouping and naming
- Each OID has properties: `oidGroup`, `oidName`, `oidOid`, `oidOptional`, `oidWriteable`
- OID validation ensures proper format and prevents naming conflicts
- State IDs are constructed from `${oidGroup}.${oidName}`

### SNMP Session Management
- Use net-snmp library for creating SNMP sessions
- Handle connection timeouts and retries appropriately
- Clean up sessions in the adapter's `unload()` method
- Support both IPv4 and IPv6 addresses

### Configuration Structure
- `config.oids`: Array of OID definitions for polling
- `config.authSets`: Authentication configurations for SNMP v3
- `config.devs`: Device definitions with IP addresses and timing settings
- Migration handling for config version updates (see installUtils.js)

### Error Handling
- Handle SNMP timeouts gracefully
- Log device connectivity issues appropriately
- Validate OID responses and handle type conversions
- Use proper log levels: error for failures, warn for connectivity issues, debug for protocol details

## Basic Development Guidelines

### ioBroker Adapter Patterns
- Follow ioBroker adapter development patterns and conventions
- Use appropriate logging levels (`adapter.log.error`, `warn`, `info`, `debug`)
- Implement proper error handling and recovery mechanisms
- Ensure clean resource cleanup in `unload()` method
- Use `adapter.setState()` and `adapter.getState()` for state management
- Implement proper lifecycle management (`ready`, `unload`, `stateChange`)

### Code Organization
- Keep main logic in `main.js`
- Use `lib/` directory for utility modules (like `installUtils.js`)
- Follow ES6+ patterns and async/await where appropriate
- Use proper TypeScript types when working with .ts files
- Maintain compatibility with Node.js version specified in package.json (currently >=20)

### Configuration and Admin Interface
- Use JSON configuration schema in `admin/jsonConfig.json`
- Provide proper translations in `admin/i18n/` directories
- Handle configuration migration between adapter versions
- Validate configuration data thoroughly before use

## Testing

### Unit Testing
- Use Mocha as the primary testing framework for ioBroker adapters (see `test/` directory)
- Write comprehensive unit tests for all functions
- Mock external dependencies and ioBroker core functions
- Test error conditions and edge cases thoroughly
- Use `@iobroker/testing` framework for standard adapter tests

### Integration Testing  
- Test adapter startup and shutdown procedures
- Verify configuration validation works correctly
- Test adapter behavior with various device configurations
- Validate state creation and updates
- Test network error conditions and recovery

### Testing Best Practices
- Keep test files in the `test/` directory
- Use descriptive test names that explain the scenario
- Setup and teardown test environments properly
- Mock external APIs and network calls
- Test both success and failure scenarios
- Use async/await for asynchronous test code

## Configuration and Admin Interface

### JSON Configuration Schema
- Define configuration schema in `admin/jsonConfig.json`
- Use proper input validation and constraints
- Provide clear field descriptions and help text
- Group related configuration options logically
- Support multiple languages for labels and descriptions

### Multi-language Support
- Store translations in `admin/i18n/` directories
- Support at minimum: English (en), German (de)
- Use consistent translation keys across the application
- Update word lists when adding new translatable content

### Configuration Best Practices
- Validate all user inputs thoroughly
- Provide sensible defaults for all options
- Use appropriate input types (text, number, checkbox, select)
- Show/hide conditional options based on other settings
- Provide tooltips and help text for complex options

## State Management

### State Creation and Naming
- Create states with descriptive, hierarchical names
- Use proper state roles (e.g., `value`, `indicator.connected`, `level`)
- Set appropriate data types and units
- Follow ioBroker state naming conventions
- Group related states logically using folders/channels

### State Updates
- Always use `adapter.setState()` with proper acknowledgment
- Handle state changes in `stateChange` events appropriately  
- Validate values before setting states
- Use proper error handling for state operations
- Consider rate limiting for frequently updated values

### Readable and Writable States
- Mark states as readable/writable appropriately
- Implement proper validation for writable states
- Handle state changes from external sources
- Provide feedback on write operations
- Log important state changes appropriately

## Error Handling and Logging

### Logging Best Practices
- Use appropriate log levels consistently:
  - `error`: For serious errors that affect functionality
  - `warn`: For warnings that don't stop operation
  - `info`: For important operational information  
  - `debug`: For detailed debugging information
- Include relevant context in log messages
- Use structured logging for complex data
- Avoid logging sensitive information (passwords, tokens)

### Error Handling Patterns
- Always handle promise rejections
- Use try-catch blocks for synchronous code that might throw
- Provide meaningful error messages to users
- Implement retry logic for transient failures
- Gracefully handle network and device errors
- Log errors with sufficient context for debugging

### Connection Management
- Implement proper timeout handling
- Retry connections with exponential backoff
- Update connection state indicators
- Clean up resources on connection failures
- Provide clear status information to users

## Security Considerations

### Credential Management
- Never hardcode passwords or API keys
- Use secure storage for sensitive configuration data
- Support encrypted configuration fields where appropriate
- Validate and sanitize all user inputs
- Use HTTPS/TLS for external API communications

### Network Security
- Implement proper input validation for network data
- Use secure protocols where available (SNMP v3 with auth/priv)
- Handle certificate validation appropriately
- Be cautious with user-provided URLs and endpoints
- Implement rate limiting to prevent abuse

## Performance and Resource Management

### Memory Management
- Clean up timers and intervals in `unload()`
- Close network connections properly
- Remove event listeners when no longer needed
- Avoid memory leaks in long-running operations
- Monitor memory usage in resource-intensive operations

### Efficient Polling
- Use appropriate polling intervals (not too frequent)
- Batch operations where possible
- Implement backoff strategies for errors
- Cache results when appropriate
- Stop polling when adapter is stopping

### Resource Cleanup
- Always implement proper `unload()` method
- Close all open connections and streams
- Clear all timers and intervals
- Remove temporary files if created
- Properly dispose of external library resources

## Code Quality and Maintenance

### Code Style
- Use ESLint configuration from `eslint.config.mjs`
- Follow existing code patterns and conventions
- Use consistent indentation and formatting
- Add JSDoc comments for functions and classes
- Keep functions focused and not too long

### Dependency Management
- Keep dependencies up to date
- Use exact versions for critical dependencies
- Minimize the number of external dependencies
- Regularly audit dependencies for security issues
- Document any version constraints or compatibility requirements

### Documentation
- Update README.md with relevant changes
- Document configuration options clearly
- Provide examples for common use cases
- Update changelog following existing format
- Include troubleshooting information for common issues

### Version Control
- Use meaningful commit messages
- Keep commits focused and atomic
- Use proper branching strategy
- Tag releases appropriately
- Include all necessary files in version control

Remember that this adapter deals with network protocols and device communication, so robust error handling, proper timeouts, and clear logging are especially important for troubleshooting connectivity issues.