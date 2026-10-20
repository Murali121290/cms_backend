#!/usr/bin/perl
# universal_converter.pl  (v2)  BITS/JATS InDesign XML  <->  XHTML for browser proof correction
#
#   perl universal_converter.pl xml2xhtml  in.xml|dir    mapping_config.json [out_file|dir] [indesign.css]
#   perl universal_converter.pl xhtml2xml  in.xhtml|dir  mapping_config.json [out_file|dir]
#
# What it does
#   * aid:pstyle / aid:cstyle (real attributes, or the old <!-- aid:pstyle="x" --> comments) become CSS classes,
#     so the InDesign-exported CSS styles the page. The original attribute is kept in data-ns-aid-pstyle /
#     data-ns-aid-cstyle and written back on the way out.
#   * <?tsp ...?> typesetting instructions travel untouched (as PIs, or as <span class="tsp"> markers).
#   * The root element, its namespace declarations and the DOCTYPE are stored in the XHTML, so no regex patching
#     of the output XML is needed any more.
use strict;
use warnings;
use utf8;
use XML::LibXML;
use JSON::PP;
use File::Path qw(make_path);
use File::Basename;

my ($mode, $in_param, $config_file, $out_param, $css_file) = @ARGV;
unless ($mode && $in_param && $config_file && $mode =~ /^(?:xml2xhtml|xhtml2xml)$/) {
    die "Usage: perl $0 <xml2xhtml|xhtml2xml> <input_file_or_dir> <config.json> [output_file_or_dir] [indesign.css]\n";
}

# ---------------------------------------------------------------- config
sub read_file {
    my ($p) = @_;
    open my $fh, '<:raw', $p or die "Cannot open '$p': $!\n";
    local $/ = undef;
    my $c = <$fh>;
    close $fh;
    return $c;
}
sub save_file {
    my ($path, $content) = @_;
    open my $fh, '>:raw', $path or die "Cannot save '$path': $!\n";
    print $fh $content;
    close $fh;
}
sub save_text {                       # character string -> UTF-8 file
    my ($path, $content) = @_;
    open my $fh, '>:encoding(UTF-8)', $path or die "Cannot save '$path': $!\n";
    print $fh $content;
    close $fh;
}

my $config = decode_json(read_file($config_file));
my %OPT = (
    tsp_mode          => 'pi',          # pi   = keep <?tsp ...?> as real processing instructions
                                        # span = <span class="tsp" data-pi="tsp ..."> (safer if your editor parses as text/html)
    pstyle_attr       => 'aid:pstyle',
    cstyle_attr       => 'aid:cstyle',
    sanitize_classes  => 1,             # characters outside [A-Za-z0-9_-] become "_" (InDesign does the same in its CSS)
    cell_tags         => ['td', 'th'],  # style class of a cell gets a prefix so it does not double the inner <p> style
    cell_class_prefix => 'cell-',
    block_default     => 'div',         # unmapped element that carries aid:pstyle
    inline_default    => 'span',        # unmapped element without aid:pstyle
    link_tags         => ['ext-link', 'uri'],
    css_replace       => [],
    list_markers      => {},
    list_numbers      => [],
    root_fallback     => ($config->{xhtml_to_xml_root} || 'book'),
);
%OPT = (%OPT, %{ $config->{options} || {} });
my %IS_CELL = map { $_ => 1 } @{ $OPT{cell_tags} };
my %IS_LINK = map { $_ => 1 } @{ $OPT{link_tags} };
my $XML_NS  = 'http://www.w3.org/XML/1998/namespace';

# ---------------------------------------------------------------- input / output paths
my @file_queue;
if (-f $in_param) {
    push @file_queue, $in_param;
} elsif (-d $in_param) {
    opendir(my $dh, $in_param) or die "Cannot open directory '$in_param': $!\n";
    my $ext = ($mode eq 'xml2xhtml') ? qr/\.xml$/i : qr/\.xhtml$/i;
    @file_queue = sort map { "$in_param/$_" } grep { $_ =~ $ext } readdir($dh);
    closedir($dh);
} else {
    die "Input path '$in_param' does not exist as a file or directory.\n";
}

my $out_dir;
if ($out_param) {
    $out_dir = ($out_param =~ /\.(?:xml|xhtml)$/i) ? dirname($out_param) : $out_param;
} else {
    $out_dir = ($mode eq 'xml2xhtml') ? "xhtml_output" : "xml_output";
}
make_path($out_dir) unless -d $out_dir;

# ---------------------------------------------------------------- CSS (xml2xhtml only)
my @css_links;
if ($mode eq 'xml2xhtml') {
    save_text("$out_dir/review_base.css",    base_css());
    save_text("$out_dir/review_overlay.css", overlay_css());
    push @css_links, 'review_base.css';

    if ($css_file && -e $css_file) {
        my $css = read_file($css_file);
        utf8::decode($css);
        # p.Para-FL {  ->  .Para-FL {   (class selectors must match whatever element we generate)
        $css =~ s{(^|[\n,])([ \t]*)[A-Za-z][A-Za-z0-9_-]*\.(?=[A-Za-z_-])}{$1$2.}g;
        for my $pair (@{ $OPT{css_replace} }) {
            my ($from, $to) = @$pair;
            $css =~ s/\Q$from\E/$to/gi;
        }
        my $name = basename($css_file);
        save_text("$out_dir/$name", $css);
        push @css_links, $name;
    } elsif ($css_file) {
        warn "CSS file '$css_file' not found - XHTML will be written without InDesign CSS.\n";
    }
    push @css_links, 'review_overlay.css';
}

# ---------------------------------------------------------------- main loop
foreach my $full_path (@file_queue) {
    my ($file_name) = fileparse($full_path, qr/\.[^.]*/);
    my $target_out_path;
    if ($out_param && $out_param =~ /\.(?:xml|xhtml)$/i && @file_queue == 1) {
        $target_out_path = $out_param;
    } else {
        $target_out_path = "$out_dir/$file_name" . (($mode eq 'xml2xhtml') ? '.xhtml' : '.xml');
    }

    my $parser = XML::LibXML->new(load_ext_dtd => 0, no_network => 1);
    my $dom    = $parser->parse_file($full_path);
    my $out    = XML::LibXML::Document->new('1.0', 'UTF-8');

    if ($mode eq 'xml2xhtml') {
        my $html = $out->createElement('html');
        $html->setAttribute('xmlns',       'http://www.w3.org/1999/xhtml');
        $html->setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
        $out->setDocumentElement($html);

        my $head = $out->createElement('head');
        $html->appendChild($head);
        my $t = $out->createElement('title');
        $t->appendChild($out->createTextNode($file_name));
        $head->appendChild($t);

        # remember what is needed to rebuild the XML document
        my $root = $dom->documentElement;
        add_meta($out, $head, 'xml-root', $root->nodeName);
        if (my $dtd = $dom->internalSubset) {
            add_meta($out, $head, 'xml-doctype-public', $dtd->publicId) if defined $dtd->publicId;
            add_meta($out, $head, 'xml-doctype-system', $dtd->systemId) if defined $dtd->systemId;
        }
        foreach my $href (@css_links) {
            my $link = $out->createElement('link');
            $link->setAttribute('rel',  'stylesheet');
            $link->setAttribute('type', 'text/css');
            $link->setAttribute('href', $href);
            $head->appendChild($link);
        }

        my $body = $out->createElement('body');
        $html->appendChild($body);

        my $conv = convert_xml_to_xhtml($root, $out, $config->{xml_to_xhtml} || {});
        foreach my $ns ($root->getNamespaces) {            # xmlns:aid, xmlns:xlink ... of the root
            my $p = $ns->declaredPrefix;
            $conv->setAttribute('data-xmlns-' . (defined $p && length $p ? $p : '_default'), $ns->declaredURI);
        }
        $body->appendChild($conv);

        my $xhtml = $out->toString(0);
        # keep the file safe for text/html parsers too: <span/> -> <span></span> (non-void elements only)
        $xhtml =~ s{<(span|a|div|p|td|th|li|i|b|h2)((?:\s[^>]*?)?)/>}{<$1$2></$1>}g;
        $xhtml =~ s{}{};
        save_file($target_out_path, $xhtml);

    } else {
        my ($body) = $dom->findnodes('//*[local-name()="body"]');
        $body ||= $dom->documentElement;

        my $meta = sub {
            my ($n) = $dom->findnodes('//*[local-name()="meta"][@name="' . $_[0] . '"]');
            return $n ? $n->getAttribute('content') : undef;
        };

        my @kids;
        foreach my $child ($body->childNodes) {
            push @kids, convert_xhtml_to_xml($child, $out, $config->{xhtml_to_xml} || {});
        }
        my @els = grep { $_->nodeType == XML_ELEMENT_NODE } @kids;

        my $root;
        if (@els == 1 && $els[0]->nodeName ne 'html') {
            $root = $els[0];
        } else {
            $root = $out->createElement($meta->('xml-root') || $OPT{root_fallback});
            $root->appendChild($_) for @kids;
        }
        $out->setDocumentElement($root);

        my ($pub, $sys) = ($meta->('xml-doctype-public'), $meta->('xml-doctype-system'));
        $out->createInternalSubset($root->nodeName, $pub, $sys) if defined $pub || defined $sys;
        my $xml = $out->toString(0);
        $xml =~ s{<para}{<p}g;
        $xml =~ s{</para>}{</p><enter\/>}g;
        
        save_file($target_out_path, $xml);
    }
    print "Written: $target_out_path\n";
}
print "Conversion complete!\n";

# ================================================================= XML -> XHTML
sub add_meta {
    my ($doc, $head, $name, $content) = @_;
    my $m = $doc->createElement('meta');
    $m->setAttribute('name', $name);
    $m->setAttribute('content', $content);
    $head->appendChild($m);
}

sub css_class {
    my ($v) = @_;
    $v =~ s/^\s+|\s+$//g;
    $v =~ s/[^A-Za-z0-9_-]/_/g if $OPT{sanitize_classes};
    return $v;
}

sub convert_xml_to_xhtml {
    my ($node, $out, $map_cfg) = @_;
    my $type = $node->nodeType;

    return $out->createTextNode($node->nodeValue) if $type == XML_TEXT_NODE || $type == XML_CDATA_SECTION_NODE;
    return $out->createComment($node->nodeValue)  if $type == XML_COMMENT_NODE;

    if ($type == XML_PI_NODE) {                       # <?tsp ...?>
        my ($target, $data) = ($node->nodeName, $node->nodeValue);
        $data = '' unless defined $data;
        if ($OPT{tsp_mode} eq 'span') {
            my $s = $out->createElement('span');
            $s->setAttribute('class', 'tsp');
            $s->setAttribute('data-pi', length $data ? "$target $data" : $target);
            $s->setAttribute('contenteditable', 'false');
            return $s;
        }
        return $out->createProcessingInstruction($target, $data);
    }
    return undef unless $type == XML_ELEMENT_NODE;

    my $tag = $node->nodeName;

    # attributes (namespace declarations are not attributes for us)
    my @attrs = grep { $_->nodeType == XML_ATTRIBUTE_NODE } $node->attributes;
    my ($pstyle, $cstyle);
    foreach my $a (@attrs) {
        $pstyle = $a->nodeValue if $a->nodeName eq $OPT{pstyle_attr};
        $cstyle = $a->nodeValue if $a->nodeName eq $OPT{cstyle_attr};
    }
    # older exports: <!-- aid:pstyle="Head1" --> as a child comment
    foreach my $c ($node->childNodes) {
        next unless $c->nodeType == XML_COMMENT_NODE;
        if ($c->nodeValue =~ /aid:pstyle\s*=\s*"([^"]+)"/) { $pstyle //= $1 }
        if ($c->nodeValue =~ /aid:cstyle\s*=\s*"([^"]+)"/) { $cstyle //= $1 }
    }

    # which rule applies?
    my $entry = $map_cfg->{$tag};
    my $rule;
    if (ref($entry) eq 'ARRAY') {
        foreach my $cand (@$entry) {
            if ($cand->{xpath}) {
                if ($node->exists($cand->{xpath})) { $rule = $cand; last; }
            } elsif ($cand->{default}) {
                $rule = $cand;
            }
        }
    } else {
        $rule = $entry;
    }

    my $target_tag;
    if ($rule && $rule->{target_tag}) {
        $target_tag = $rule->{target_tag};
    } elsif ($tag =~ /^(?:p|div|ul|ol|li|h[1-6]|table|thead|tbody|tfoot|tr|td|th|colgroup|col|caption|span|i|b|a|sub|sup)$/i) {
        $target_tag = lc($tag);
    } else {
        $target_tag = defined $pstyle ? $OPT{block_default} : $OPT{inline_default};
    }

    my $elem = $out->createElement($target_tag);
    $elem->setAttribute('data-xml-tag', $tag);

    # classes: semantic class from config, then the InDesign style names
    my @classes;
    push @classes, $rule->{class} if $rule && $rule->{class};
    my $prefix = $IS_CELL{$target_tag} ? $OPT{cell_class_prefix} : '';
    push @classes, $prefix . css_class($pstyle) if defined $pstyle && length $pstyle;
    push @classes, css_class($cstyle)           if defined $cstyle && length $cstyle;
    my %seen;
    @classes = grep { !$seen{$_}++ } @classes;
    $elem->setAttribute('class', join(' ', @classes)) if @classes;

    # the style attributes the old comment form carried must survive the round trip as well
    $elem->setAttribute('data-ns-aid-pstyle', $pstyle) if defined $pstyle && !grep { $_->nodeName eq $OPT{pstyle_attr} } @attrs;
    $elem->setAttribute('data-ns-aid-cstyle', $cstyle) if defined $cstyle && !grep { $_->nodeName eq $OPT{cstyle_attr} } @attrs;

    foreach my $a (@attrs) {
        my $name = $a->nodeName;
        my $val  = $a->nodeValue;
        if ($name =~ /^([^:]+):(.+)$/) {              # aid:pstyle, xlink:href, xml:lang ...
            my ($pfx, $loc) = ($1, $2);
            $elem->setAttribute("data-ns-$pfx-$loc", $val);
            if ($loc eq 'href') {                     # visible link target for the browser
                $val =~ s{^http://(?=https://)}{};
                $val =~ s{^(?:http://)+}{http://};
                $val =~ s{^(?:https://)+}{https://};
                $elem->setAttribute('href', $val);
            }
        } elsif ($name eq 'class') {
            $elem->setAttribute('data-attr-class', $val);
        } else {
            $elem->setAttribute($name, $val);
        }
    }

    foreach my $child ($node->childNodes) {
        my $c = convert_xml_to_xhtml($child, $out, $map_cfg);
        $elem->appendChild($c) if $c;
    }
    return $elem;
}

# ================================================================= XHTML -> XML
sub convert_xhtml_to_xml {                            # returns a LIST of nodes (0 = dropped, many = unwrapped)
    my ($node, $out, $map_cfg) = @_;
    my $type = $node->nodeType;

    return $out->createTextNode($node->nodeValue) if $type == XML_TEXT_NODE || $type == XML_CDATA_SECTION_NODE;
    return $out->createProcessingInstruction($node->nodeName, $node->nodeValue // '') if $type == XML_PI_NODE;

    if ($type == XML_COMMENT_NODE) {
        # a text/html parser turns <?tsp T v=1?> into the comment "?tsp T v=1?"
        if ($node->nodeValue =~ /^\?(\S+?)(?:\s+(.*?))?\?$/s) {
            return $out->createProcessingInstruction($1, $2 // '');
        }
        return $out->createComment($node->nodeValue);
    }
    return () unless $type == XML_ELEMENT_NODE;

    my $html_tag = lc($node->localname);

    # <span class="tsp" data-pi="tsp T v=1"> marker
    if ($node->hasAttribute('data-pi')) {
        my ($t, $d) = split /\s+/, $node->getAttribute('data-pi'), 2;
        return $out->createProcessingInstruction($t, $d // '');
    }

    my $target_tag = $node->getAttribute('data-xml-tag');
    my $rule = $map_cfg->{$html_tag};
    $rule = (grep { ref $_ eq 'HASH' && $_->{default} } @$rule)[0] if ref($rule) eq 'ARRAY';
    $rule = undef unless ref($rule) eq 'HASH';
    $rule = $rule->{default} if $rule && ref($rule->{default}) eq 'HASH';

    if (!$target_tag) {                               # element created in the browser
        if ($rule && $rule->{unwrap}) {
            return map { convert_xhtml_to_xml($_, $out, $map_cfg) } $node->childNodes;
        }
        $target_tag = ($rule && $rule->{target_tag}) ? $rule->{target_tag} : $html_tag;
    }

    my $elem = $out->createElement($target_tag);
    my %have;

    foreach my $a (grep { $_->nodeType == XML_ATTRIBUTE_NODE } $node->attributes) {
        my $name = $a->nodeName;
        my $val  = $a->nodeValue;
        next if $name eq 'class' || $name eq 'data-xml-tag' || $name eq 'data-pi';
        next if $name =~ /^(?:contenteditable|spellcheck|style|data-tsp.*)$/;
        if ($name =~ /^data-xmlns-(.+)$/) {            # namespace declarations of the root element
            my $p = $1;
            $elem->setNamespace($val, ($p eq '_default' ? undef : $p), 0);
            next;
        }
        if ($name =~ /^data-ns-([^-]+)-(.+)$/) {       # data-ns-aid-pstyle -> aid:pstyle
            $elem->setAttribute("$1:$2", $val);
            $have{"$1:$2"} = 1;
            next;
        }
        if ($name eq 'data-attr-class') { $elem->setAttribute('class', $val); next; }
        if ($name eq 'href') { $have{href} = $val; next; }
        $elem->setAttribute($name, $val);
    }

    # links: the (possibly edited) href wins over the stored xlink:href
    if (defined $have{href} && ($IS_LINK{$target_tag} || exists $have{'xlink:href'})) {
        $elem->setAttribute('xlink:href', $have{href});
    } elsif (defined $have{href}) {
        $elem->setAttribute('href', $have{href});
    }

    # styles for elements the author created (e.g. <i> -> <italic aid:cstyle="italic">)
    if ($rule) {
        $elem->setAttribute($OPT{cstyle_attr}, $rule->{aid_cstyle}) if $rule->{aid_cstyle} && !$have{$OPT{cstyle_attr}};
        $elem->setAttribute($OPT{pstyle_attr}, $rule->{aid_pstyle}) if $rule->{aid_pstyle} && !$have{$OPT{pstyle_attr}};
    }

    foreach my $child ($node->childNodes) {
        $elem->appendChild($_) for convert_xhtml_to_xml($child, $out, $map_cfg);
    }
    return $elem;
}

# ================================================================= generated CSS
sub base_css {
    return <<'CSS';
/* review_base.css - loaded FIRST. All selectors use :where() = zero specificity,
   so every rule of the InDesign CSS (loaded next) wins over these browser-default resets. */
:where(html, body) { margin: 0; }
:where(body)       { padding: 1em; background: #fff; }
:where(p, h2, ul, ol, li, div, table, figure) { margin: 0; padding: 0; }
:where(h2)         { font-size: inherit; font-weight: inherit; }
:where(ul, ol)     { list-style: none; }
:where(table)      { border-collapse: collapse; width: 100%; }
:where(td, th)     { vertical-align: top; text-align: left; }
:where(a)          { color: inherit; text-decoration: none; }
CSS
}

sub overlay_css {
    my $css = <<'CSS';
/* review_overlay.css - loaded LAST: proof-reading aids. Delete a block if you do not want it. */
body { max-width: var(--text-width, 46em); margin-left: auto; margin-right: auto; }

/* paragraph-style elements that were mapped to an inline span must still break lines */
span[data-ns-aid-pstyle] { display: block; }

/* typesetting markers are never shown */
.tsp { display: none; }

.enter { display: none; }

/* text that exists only for the PDF (separators etc.) - keep in flow, mark lightly */
.onlyforpdf { background: #f1f1f1; }

/* figures: the EPS/TIFF cannot be shown in a browser, so show a placeholder with the file name */
.graphic { display: block; box-sizing: border-box; border: 1px dashed #999; color: #666; padding: 2em; text-align: center; font: 12px monospace; }
.graphic::before { content: "[graphic] " attr(data-ns-xlink-href); }

/* faint table grid so empty cell structure is visible while correcting */
td, th { border: 1px solid #e3e3e3; }

/* Color highlighting for bibliography & reference elements */
.string-name   { color: #8b0000 !important; }
.given-names   { color: #006400 !important; }
.year          { color: #d97706 !important; }
.article-title { color: #1e40af !important; }
.source        { color: #6b21a8 !important; }
.volume        { color: #0d9488 !important; }
.issue         { color: #be185d !important; }
.fpage         { color: #4338ca !important; }
.lpage         { color: #c05621 !important; }
.ext-link      { color: #2563eb !important; text-decoration: underline; }
.chapter-title { color: #047857 !important; font-weight: bold; }
.collab        { color: #b45309 !important; }
CSS
    my $m = $OPT{list_markers} || {};
    if (%$m) {
        $css .= "\n/* list markers (InDesign generates them, they are not in the XML) */\n";
        foreach my $ps (sort keys %$m) {
            my $c = $m->{$ps};
            $c =~ s/(["\\])/\\$1/g;
            $css .= "p." . css_class($ps) . "::before { content: \"$c\\00a0\"; }\n";
        }
    }
    my $n = $OPT{list_numbers} || [];
    if (@$n) {
        $css .= "\n/* numbered lists: counter restarts with every <ol> */\nol { counter-reset: tsplist; }\n";
        foreach my $ps (@$n) {
            my $cls = css_class($ps);
            $css .= "li > p.${cls}::before { counter-increment: tsplist; content: counter(tsplist) \".\\00a0\"; }\n";
        }
    }
    return $css;
}
