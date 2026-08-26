package mcp

import (
	_ "embed"
	"fmt"
	"strings"
	"unicode"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	descriptorpb "google.golang.org/protobuf/types/descriptorpb"

	// Import proto packages so their file descriptors register with the global registry.
	_ "github.com/roarc0/squirrel/proto/gen/go/v1"
)

//go:embed proto_image.binpb
var protoImageBytes []byte

// protoComments maps "ServiceName.MethodName" to the leading proto comment.
var protoComments = func() map[string]string {
	m := make(map[string]string)
	var fds descriptorpb.FileDescriptorSet
	if err := proto.Unmarshal(protoImageBytes, &fds); err != nil {
		return m
	}
	for _, f := range fds.GetFile() {
		// Index source locations by their path string.
		locByPath := make(map[string]string)
		for _, loc := range f.GetSourceCodeInfo().GetLocation() {
			if loc.LeadingComments == nil {
				continue
			}
			key := pathKey(loc.GetPath())
			locByPath[key] = strings.TrimSpace(*loc.LeadingComments)
		}
		for si, svc := range f.GetService() {
			for mi, method := range svc.GetMethod() {
				// FileDescriptorProto.service = field 6; ServiceDescriptorProto.method = field 2.
				path := pathKey([]int32{6, int32(si), 2, int32(mi)})
				if comment, ok := locByPath[path]; ok && comment != "" {
					key := fmt.Sprintf("%s.%s", svc.GetName(), method.GetName())
					m[key] = comment
				}
			}
		}
	}
	return m
}()

// allowedServices is the set of service full names exposed as MCP tools.
var allowedServices = map[protoreflect.FullName]bool{
	"v1.HoldingService":    true,
	"v1.AccountService":    true,
	"v1.InstrumentService": true,
	"v1.SummaryService":    true,
	"v1.SnapshotService":   true,
	"v1.RateService":       true,
}

// deniedMethods is the set of full method names that should NOT be exposed.
var deniedMethods = map[protoreflect.FullName]bool{
	"v1.InstrumentService.SyncInstrumentCatalog":    true,
	"v1.InstrumentService.EnrichInstrumentCatalog":  true,
	"v1.InstrumentService.StreamInstrumentCatalog":  true,
	"v1.InstrumentService.ImportInstruments":        true,
	"v1.InstrumentService.StarInstrument":           true,
	"v1.InstrumentService.GetInstrumentAlternatives": true,
	"v1.InstrumentService.ListInstruments":          true, // too large; use search/lookup instead
}

// buildToolsFromProto discovers all allowed unary RPC methods from the global proto registry
// and generates ToolDefinitions with JSON schemas derived from proto message descriptors.
func buildToolsFromProto() []ToolDefinition {
	var tools []ToolDefinition

	protoregistry.GlobalFiles.RangeFiles(func(fd protoreflect.FileDescriptor) bool {
		if !strings.HasPrefix(fd.Path(), "v1/") {
			return true
		}
		services := fd.Services()
		for i := 0; i < services.Len(); i++ {
			sd := services.Get(i)
			if !allowedServices[sd.FullName()] {
				continue
			}
			methods := sd.Methods()
			for j := 0; j < methods.Len(); j++ {
				md := methods.Get(j)
				if md.IsStreamingClient() || md.IsStreamingServer() {
					continue
				}
				if deniedMethods[md.FullName()] {
					continue
				}
				tools = append(tools, toolFromMethod(md))
			}
		}
		return true
	})

	return tools
}

func toolFromMethod(md protoreflect.MethodDescriptor) ToolDefinition {
	svcName := string(md.Parent().Name())
	methodName := string(md.Name())
	toolName := camelToSnake(svcName) + "_" + camelToSnake(methodName)
	// Remove redundant service prefix when it duplicates the method name.
	// e.g. holding_service_list_holdings → list_holdings
	svcPrefix := camelToSnake(svcName) + "_"
	if idx := strings.Index(toolName, svcPrefix); idx == 0 {
		// strip service prefix, keep method part
		toolName = camelToSnake(methodName)
	}

	rpcPath := "/" + string(md.Parent().FullName()) + "/" + methodName

	inputSchema := schemaForMessage(md.Input(), map[string]bool{})

	return ToolDefinition{
		Name:        toolName,
		Description: buildDescription(md),
		InputSchema: inputSchema,
		RPCPath:     rpcPath,
	}
}

func pathKey(path []int32) string {
	parts := make([]string, len(path))
	for i, p := range path {
		parts[i] = fmt.Sprintf("%d", p)
	}
	return strings.Join(parts, ",")
}

func buildDescription(md protoreflect.MethodDescriptor) string {
	key := fmt.Sprintf("%s.%s", md.Parent().Name(), md.Name())
	if comment, ok := protoComments[key]; ok && comment != "" {
		return comment
	}
	return fmt.Sprintf("%s: %s", md.Parent().Name(), md.Name())
}

// schemaForMessage converts a proto MessageDescriptor to a JSON Schema map.
func schemaForMessage(md protoreflect.MessageDescriptor, visiting map[string]bool) map[string]interface{} {
	fullName := string(md.FullName())
	if visiting[fullName] {
		return map[string]interface{}{"type": "object"}
	}
	visiting[fullName] = true
	defer delete(visiting, fullName)

	props := map[string]interface{}{}
	fields := md.Fields()
	for i := 0; i < fields.Len(); i++ {
		fd := fields.Get(i)
		props[fd.JSONName()] = schemaForField(fd, visiting)
	}

	return map[string]interface{}{
		"type":       "object",
		"properties": props,
	}
}

func schemaForField(fd protoreflect.FieldDescriptor, visiting map[string]bool) map[string]interface{} {
	if fd.IsMap() {
		return map[string]interface{}{"type": "object"}
	}
	base := singularSchema(fd, visiting)
	if fd.IsList() {
		return map[string]interface{}{
			"type":  "array",
			"items": base,
		}
	}
	return base
}

func singularSchema(fd protoreflect.FieldDescriptor, visiting map[string]bool) map[string]interface{} {
	switch fd.Kind() {
	case protoreflect.BoolKind:
		return map[string]interface{}{"type": "boolean"}
	case protoreflect.Int32Kind, protoreflect.Sint32Kind, protoreflect.Sfixed32Kind,
		protoreflect.Uint32Kind, protoreflect.Fixed32Kind:
		return map[string]interface{}{"type": "integer"}
	case protoreflect.Int64Kind, protoreflect.Sint64Kind, protoreflect.Sfixed64Kind,
		protoreflect.Uint64Kind, protoreflect.Fixed64Kind:
		return map[string]interface{}{"type": "integer"}
	case protoreflect.FloatKind, protoreflect.DoubleKind:
		return map[string]interface{}{"type": "number"}
	case protoreflect.StringKind:
		return map[string]interface{}{"type": "string"}
	case protoreflect.BytesKind:
		return map[string]interface{}{"type": "string", "format": "byte"}
	case protoreflect.EnumKind:
		vals := fd.Enum().Values()
		enum := make([]interface{}, vals.Len())
		for i := 0; i < vals.Len(); i++ {
			enum[i] = string(vals.Get(i).Name())
		}
		return map[string]interface{}{"type": "string", "enum": enum}
	case protoreflect.MessageKind, protoreflect.GroupKind:
		wkt := wellKnownSchema(fd.Message().FullName())
		if wkt != nil {
			return wkt
		}
		return schemaForMessage(fd.Message(), visiting)
	}
	return map[string]interface{}{"type": "string"}
}

func wellKnownSchema(name protoreflect.FullName) map[string]interface{} {
	switch name {
	case "google.protobuf.Timestamp":
		return map[string]interface{}{"type": "string", "format": "date-time"}
	case "google.protobuf.Duration":
		return map[string]interface{}{"type": "string"}
	case "google.protobuf.StringValue":
		return map[string]interface{}{"type": "string"}
	case "google.protobuf.Int64Value", "google.protobuf.UInt64Value",
		"google.protobuf.Int32Value", "google.protobuf.UInt32Value":
		return map[string]interface{}{"type": "integer"}
	case "google.protobuf.BoolValue":
		return map[string]interface{}{"type": "boolean"}
	case "google.protobuf.DoubleValue", "google.protobuf.FloatValue":
		return map[string]interface{}{"type": "number"}
	case "google.protobuf.Struct":
		return map[string]interface{}{"type": "object"}
	case "google.protobuf.Value":
		return map[string]interface{}{}
	}
	return nil
}

// camelToSnake converts CamelCase to snake_case.
func camelToSnake(s string) string {
	var b strings.Builder
	for i, r := range s {
		if unicode.IsUpper(r) && i > 0 {
			b.WriteByte('_')
		}
		b.WriteRune(unicode.ToLower(r))
	}
	return b.String()
}
