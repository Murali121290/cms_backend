#!/usr/bin/perl
use strict;
use warnings;
use XML::LibXML;
use JSON::PP;
use File::Path qw(make_path);
use File::Basename;

my ($mode, $in_param, $config_file, $out_param, $css_file) = @ARGV;

unless ($mode && $in_param && $config_file) {
    die "Usage: perl $0 <xml2xhtml|xhtml2xml> <input_file_or_dir> <config.json> [output_file_or_dir] [indesign.css]\n";
}

# Resolve input files (handles single file vs directory)
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

# Resolve output directory
my $out_dir;
if ($out_param) {
    if ($out_param =~ /\.(?:xml|xhtml)$/i) {
        $out_dir = dirname($out_param);
    } else {
        $out_dir = $out_param;
    }
} else {
    $out_dir = ($mode eq 'xml2xhtml') ? "xhtml_output" : "xml_output";
}
make_path($out_dir) unless -d $out_dir;

# Handle InDesign CSS File
my $css_filename = "";
if ($css_file && -e $css_file) {
    $css_filename = basename($css_file);
    if ($mode eq 'xml2xhtml') {
        open my $in_css, '<:raw', $css_file or warn "Cannot read CSS '$css_file': $!\n";
        local $/ = undef;
        my $css_content = <$in_css>;
        close $in_css;

        # Clean element selectors to match class names directly
        $css_content =~ s{\n([A-Za-z0-9_-]+)\.}{\n.}g;
        $css_content =~ s{\#ffffff}{\#0d2950}g;
        $css_content .= "\n/* Color highlighting for bibliography & reference elements */\n"
                      . ".surname {\n    color: \#8b0000 !important; /* Dark Red */\n}\n\n"
                      . ".given-names {\n    color: \#006400 !important; /* Dark Green */\n}\n\n"
                      . ".bib_year {\n    color: \#d97706 !important; /* Dark Amber / Gold */\n}\n\n"
                      . ".article-title {\n    color: \#1e40af !important; /* Deep Royal Blue */\n}\n\n"
                      . ".bib_journal {\n    color: \#6b21a8 !important; /* Dark Purple */\n}\n\n"
                      . ".bib_volume {\n    color: \#0d9488 !important; /* Teal */\n}\n\n"
                      . ".bib_issue {\n    color: \#be185d !important; /* Dark Pink / Crimson */\n}\n\n"
                      . ".bib_fpage {\n    color: \#4338ca !important; /* Indigo */\n}\n\n"
                      . ".bib_lpage {\n    color: \#c05621 !important; /* Dark Rust / Orange */\n}\n\n"
                      . ".ext-link {\n    color: \#2563eb !important; /* Bright Blue */\n    text-decoration: underline;\n}\n"
                      . ".bib_chapter-title {\n    color: \#047857 !important; /* Emerald Green */\n    font-weight: bold;\n}\n\n"
                      . ".bib_collab {\n    color: \#b45309 !important; /* Deep Ochre / Amber-Brown */\n}";

        open my $out_css, '>:raw', "$out_dir/$css_filename" or warn "Cannot write CSS: $!\n";
        print $out_css $css_content;
        close $out_css;
    }
}

open my $fh_json, '<:raw', $config_file or die "Cannot open config file '$config_file': $!\n";
local $/ = undef;
my $config = decode_json(<$fh_json>);
close $fh_json;

foreach my $full_path (@file_queue) {
    my ($file_name, $file_dir, $file_ext) = fileparse($full_path, qr/\.[^.]*/);
    
    my $target_out_path;
    if ($out_param && $out_param =~ /\.(?:xml|xhtml)$/i && @file_queue == 1) {
        $target_out_path = $out_param;
    } else {
        my $new_ext = ($mode eq 'xml2xhtml') ? '.xhtml' : '.xml';
        $target_out_path = "$out_dir/$file_name$new_ext";
    }

    open my $fh, '<:encoding(UTF-8)', $full_path or die "Cannot open $full_path: $!";
    local $/;
    my $content = <$fh>;
    close $fh;

    # Pre-clean duplicated attributes (e.g. data-xml-tag="fig" data-xml-tag="fig")
    $content =~ s/\bdata-xml-tag="([^"]*)"(?:\s+data-xml-tag="[^"]*")+/data-xml-tag="$1"/gi;
    $content =~ s/\bclass="([^"]*)"(?:\s+class="[^"]*")+/class="$1"/gi;

    my $parser  = XML::LibXML->new(recover => 2);
    my $dom = eval { $parser->parse_string($content) } || eval { $parser->parse_html_string($content) } || $parser->parse_file($full_path);
    my $out_dom = XML::LibXML::Document->new('1.0', 'UTF-8');

    if ($mode eq 'xml2xhtml') {
        my $html_root = $out_dom->createElement('html');
        $html_root->setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
        $html_root->setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

        my $head = $out_dom->createElement('head');
        if ($css_filename) {
            my $link = $out_dom->createElement('link');
            $link->setAttribute('rel', 'stylesheet');
            $link->setAttribute('type', 'text/css');
            $link->setAttribute('href', $css_filename);
            $head->appendChild($link);
        }
        $html_root->appendChild($head);

        $out_dom->setDocumentElement($html_root);

        my $body = $out_dom->createElement('body');
        $html_root->appendChild($body);

        foreach my $child ($dom->documentElement->childNodes()) {
            my $converted = convert_xml_to_xhtml($child, $out_dom, $config->{xml_to_xhtml});
            $body->appendChild($converted) if $converted;
        }
        
        my $xmlout = $out_dom->toString(1);
        $xmlout =~ s{ }{}g;
        
        save_file($target_out_path, $xmlout);

    } elsif ($mode eq 'xhtml2xml') {
        my $root_tag  = $config->{xhtml_to_xml_root} || "book";
        my $body_node = ($dom->findnodes('//body'))[0] || $dom->documentElement;

        my @converted_children;
        foreach my $child ($body_node->childNodes()) {
            my $converted = convert_xhtml_to_xml($child, $out_dom, $config->{xhtml_to_xml});
            push @converted_children, $converted if $converted;
        }

        if (@converted_children == 1 && $converted_children[0]->nodeType == XML_ELEMENT_NODE) {
            $out_dom->setDocumentElement($converted_children[0]);
        } else {
            my $xml_root = $out_dom->createElement($root_tag);
            $out_dom->setDocumentElement($xml_root);
            foreach my $c (@converted_children) {
                $xml_root->appendChild($c);
            }
        }

        my $xmlout = $out_dom->toString(1);
        $xmlout =~ s{</head>(\s*)<body>}{</head>}gs;
        $xmlout =~ s{</body>(\s*)</book>}{</book>}gs;
        $xmlout =~ s{<head>((?:(?!</head>).)*?)</head>}{}gs;
        $xmlout =~ s{<\?xml[^>]*\?>}{}gi;
        $xmlout =~ s{<\!--\s*\?xml[^>]*\?>\s*-->}{}gi;
        $xmlout =~ s{<\!--\s*<\?xml[^>]*\?>\s*-->}{}gi;
        $xmlout =~ s{<\!--\s*\?xml.*?\?>\s*-->}{}gi;

        unless ($xmlout =~ /<book-part[\s>]/i) {
            my $ch_id = "ch10";
            if ($xmlout =~ /<label>(\d+)<\/label>/) {
                $ch_id = "ch" . $1;
            }

            my $meta_html = "";
            while ($xmlout =~ s{(<(?:title-group|contrib-group|abstract|kwd-group)[\s>][\s\S]*?<\/(?:title-group|contrib-group|abstract|kwd-group)>)}{}i) {
                $meta_html .= $1 . "\n";
            }

            my $body_html = "";
            while ($xmlout =~ s{(<(?:sec)[\s>][\s\S]*?<\/(?:sec)>)}{}i) {
                $body_html .= $1 . "\n";
            }

            $xmlout =~ s{</?book[^>]*>}{}gi;
            $xmlout =~ s{</?book-body[^>]*>}{}gi;

            $xmlout = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
                    . "<!DOCTYPE book PUBLIC \"-//NLM//DTD BITS Book Interchange DTD v2.0 20130520//EN\" \"D:/s4c/wordtoxml/FirstXML/BITS-Book-1.0-DTD/BITS-book1.dtd\">\n"
                    . "<book xmlns:mml=\"http://www.w3.org/1998/Math/MathML\" xmlns:xi=\"http://www.w3.org/2001/XInclude\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xmlns:aid=\"http://ns.adobe.com/AdobeInDesign/4.0/\" dtd-version=\"1.0\" xml:lang=\"en\">\n"
                    . "<book-body>\n"
                    . "<book-part id=\"$ch_id\" book-part-type=\"chapter\">\n"
                    . "<book-part-meta>\n" . $meta_html . "</book-part-meta>\n"
                    . "<body>\n" . $body_html . $xmlout . "\n</body>\n"
                    . "</book-part>\n"
                    . "</book-body>\n"
                    . "</book>\n";
        }
        $xmlout =~ s{<strong>}{<bold>}g;
        $xmlout =~ s{</strong>}{</bold>}g;
        $xmlout =~ s{<em>}{<italic>}g;
        $xmlout =~ s{</em>}{</italic>}g;
        $xmlout =~ s{</sup>}{</sup_script>}g;
        $xmlout =~ s{ class="([^\ ]+)(\s*)([a-z]*)"}{ class="$1"}g;
        $xmlout =~ s{<delete[^>]*>((?:(?!</delete>).)*?)</delete>}{}g;
        $xmlout =~ s{<\!-- QUERY: <query>(\s*)}{<query>}gi;
        $xmlout =~ s{</query> -->}{</query>}gi;
        $xmlout =~ s{<\!--\s*<highlight>\s*-->}{<highlight>}gi;
        $xmlout =~ s{<\!--\s*</highlight>\s*-->}{</highlight>}gi;
        $xmlout =~ s{<\!--\s*<query[^>]*>\s*-->}{<query>}gi;
        $xmlout =~ s{<\!--\s*</query>\s*-->}{</query>}gi;
        $xmlout =~ s{\s+aid:(?:pstyle|cstyle)="[^"]*"}{}gi;
        $xmlout =~ s{<\!--\s*aid:(?:pstyle|cstyle)="[^"]*"\s*-->}{}gi;
        $xmlout =~ s{<insert[^>]*>((?:(?!</insert>).)*?)</insert>}{$1}g;
        $xmlout =~ s{</col>}{}g;
        $xmlout =~ s{<col ([^>]*)>}{<col $1/>}g;
        $xmlout =~ s{<col ([^>]*)//>}{<col $1/>}g;
        $xmlout =~ s{<colgroup>((?:(?!</colgroup>).)*?)</colgroup>(\s*)<table ([^>]*)>}{$2<table $3>\n<colgroup>$1</colgroup>}gs;
        $xmlout =~ s{<p\/>}{}g;
        $xmlout =~ s{(\n+)}{\n}g;
        save_file($target_out_path, $xmlout);
    }
}

print "Conversion complete!\n";

sub convert_xml_to_xhtml {
    my ($node, $out_dom, $map_cfg) = @_;

    # 1. Preserve text nodes
    return $out_dom->createTextNode($node->nodeValue) if $node->nodeType == XML_TEXT_NODE;

    # 2. Retain comments (e.g., <!-- aid:pstyle="..." -->) in output tree
    return $out_dom->createComment($node->nodeValue) if $node->nodeType == XML_COMMENT_NODE;

    return undef unless $node->nodeType == XML_ELEMENT_NODE;

    my $tag = $node->nodeName;

    # The query process: XML tag to HTML comment
    if ($tag eq 'query') {
        my $xml_str = $node->toString();
        $xml_str =~ s{^<query>\s*--\s*>}{<query>}gi;
        $xml_str =~ s{<--\s*</query>}{</query>}gi;
        $xml_str =~ s{--}{- -}g;
        return $out_dom->createComment(" QUERY: $xml_str ");
    }
        
    my $rule_entry = $map_cfg->{$tag};
    my $rule;

    if (ref($rule_entry) eq 'ARRAY') {
        foreach my $candidate (@{$rule_entry}) {
            if ($candidate->{xpath}) {
                if ($node->exists($candidate->{xpath})) {
                    $rule = $candidate;
                    last;
                }
            } elsif ($candidate->{default}) {
                $rule = $candidate;
            }
        }
    } else {
        $rule = $rule_entry;
    }

    my $target_tag;
    if ($rule && $rule->{target_tag}) {
        $target_tag = $rule->{target_tag};
    } elsif ($tag =~ /^(?:p|div|ul|ol|li|h1|h2|h3|h4|h5|h6|table|tr|td|th|tbody|thead|span|i|b|a|sub|sup)$/i) {
        $target_tag = lc($tag);
    } else {
        $target_tag = "span";
    }

    my $elem = $out_dom->createElement($target_tag);
    $elem->setAttribute('data-xml-tag', $tag);

    my @classes;
    push @classes, $rule->{class} if $rule && $rule->{class};

    # Extract aid:pstyle / aid:cstyle comments into class attribute for styling
    foreach my $child ($node->childNodes()) {
        if ($child->nodeType == XML_COMMENT_NODE) {
            my $comment_text = $child->nodeValue;
            if ($comment_text =~ /aid:(?:pstyle|cstyle)\s*=\s*"([^"]+)"/) {
                push @classes, $1;
            }
        }
    }

    $elem->setAttribute('class', join(' ', @classes)) if @classes;

    # Handle attributes
    if ($node->hasAttributes()) {
        foreach my $attr ($node->attributes()) {
            my $name  = $attr->nodeName;
            my $val   = $attr->nodeValue;

            if ($name eq 'xlink:href' || $name eq 'href') {
                $val =~ s{^http://(?=https://)}{};
                $val =~ s{^(?:http://)+}{http://};
                $val =~ s{^(?:https://)+}{https://};

                $elem->setAttribute('href', $val);
            } else {
                $elem->setAttribute($name, $val);
            }
        }
    }

    foreach my $child ($node->childNodes()) {
        my $c = convert_xml_to_xhtml($child, $out_dom, $map_cfg);
        $elem->appendChild($c) if $c;
    }

    return $elem;
}

sub convert_xhtml_to_xml {
    my ($node, $out_dom, $map_cfg) = @_;

    # Preserve text nodes
    return $out_dom->createTextNode($node->nodeValue) if $node->nodeType == XML_TEXT_NODE;

    # Preserve comment nodes
    return $out_dom->createComment($node->nodeValue) if $node->nodeType == XML_COMMENT_NODE;

    return undef unless $node->nodeType == XML_ELEMENT_NODE;

    my $html_tag = $node->nodeName;

    # Priority 1: Read original XML tag name from data-xml-tag
    my $target_tag = $node->getAttribute('data-xml-tag');

    # Priority 2: Fall back to JSON config mapping
    if (!$target_tag && exists $map_cfg->{$html_tag}) {
        if (ref($map_cfg->{$html_tag}) eq 'HASH' && $map_cfg->{$html_tag}->{target_tag}) {
            $target_tag = $map_cfg->{$html_tag}->{target_tag};
        } elsif (ref($map_cfg->{$html_tag}) eq 'HASH' && $map_cfg->{$html_tag}->{default}) {
            $target_tag = $map_cfg->{$html_tag}->{default}->{target_tag};
        }
    }
    $target_tag ||= $html_tag;

    my $elem = $out_dom->createElement($target_tag);

    #revert the query process. comment to xml.
            if ($node->nodeType == XML_COMMENT_NODE) {
            my $comment_text = $node->nodeValue;
            if ($comment_text =~ /^\s*QUERY:\s*(<query.*?>.*?<\/query>)\s*$/s) {
                my $query_xml_str = $1;
                my $chunk_parser = XML::LibXML->new();
                eval {
                    my $fragment = $chunk_parser->parse_balanced_chunk($query_xml_str);
                    return $out_dom->importNode($fragment, 1);
                };
            }
            return $out_dom->createComment($comment_text);
        }

    # Copy original XML attributes, omitting conversion metadata
    if ($node->hasAttributes()) {
        foreach my $attr ($node->attributes()) {
            my $name = $attr->nodeName;
            next if $name eq 'class' || $name eq 'data-xml-tag' || $name =~ /^data-aid-/;
            $elem->setAttribute($name, $attr->nodeValue);
        }
    }

    # Recursively convert all children (including comment nodes)
    foreach my $child ($node->childNodes()) {
        my $c = convert_xhtml_to_xml($child, $out_dom, $map_cfg);
        $elem->appendChild($c) if $c;
    }

    return $elem;
}

sub save_file {
    my ($path, $content) = @_;
    open my $fh, '>:raw', $path or die "Cannot save '$path': $!\n";
    print $fh $content;
    close $fh;
}